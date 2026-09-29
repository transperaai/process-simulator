// Builds edits (./ops.ts) from what the user did, against the process as the
// editor shows it now. Each builder returns null when there is nothing to do.
// Step and edge ids are made here, once, and never change afterwards.

import {
  triangularRange,
  type EdgeRow,
  type ProcessBundle,
  type StepKind,
  type StepOutcome,
  type StepRow,
} from "@transpera-flow/db";
import { pick, readField, type Edit, type Patch, type RowChange, type Scalar } from "./ops";

/** Kinds the palette offers. `subprocess` arrives with sub-processes. */
export const STEP_KINDS = ["task", "wait", "decision", "start", "end"] as const satisfies readonly StepKind[];
export type NewStepKind = (typeof STEP_KINDS)[number];

export const KIND_LABELS: Record<StepKind, string> = {
  task: "Task",
  wait: "Wait",
  decision: "Decision",
  subprocess: "Sub-process",
  start: "Start",
  end: "End",
};

export const OUTCOME_LABELS: Record<StepOutcome, string> = { won: "Won", lost: "Lost", done: "Done" };

/** Probabilities within this of 100% count as 100%. */
const TOLERANCE = 1e-6;

const newId = (): string => crypto.randomUUID();

const round = (v: number) => Math.round(v * 1000) / 1000;

const stepName = (bundle: ProcessBundle, id: string) => bundle.steps.find((s) => s.id === id)?.name ?? "step";

/** Defaults for a new step of each kind. */
function newStepRow(bundle: ProcessBundle, kind: NewStepKind, outcome: StepOutcome | null, x: number, y: number): StepRow {
  const { revision } = bundle;
  const names: Record<NewStepKind, string> = {
    task: "New task",
    wait: "Waiting",
    decision: "Decision",
    start: "Start",
    end: outcome ? OUTCOME_LABELS[outcome] : "End",
  };
  return {
    id: newId(),
    revision_id: revision.id,
    workspace_id: revision.workspace_id,
    process_id: revision.process_id,
    name: names[kind],
    kind,
    outcome: kind === "end" ? (outcome ?? "done") : null,
    role_id: null,
    person_id: null,
    work_hours: kind === "task" ? 1 : 0,
    work_dist: "lognormal",
    work_params: {},
    wait_hours: kind === "wait" ? 8 : 0,
    wait_dist: "lognormal",
    wait_params: {},
    rework_rate: 0,
    rework_to_step_id: null,
    tool: null,
    notes: null,
    sla_hours: null,
    current_wip: null,
    x: Math.round(x),
    y: Math.round(y),
  };
}

/** The outcome a new end step gets: won, then lost, then done, whichever the process lacks. */
export function nextOutcome(bundle: ProcessBundle): StepOutcome {
  const taken = new Set(bundle.steps.filter((s) => s.kind === "end").map((s) => s.outcome));
  return taken.has("won") ? (taken.has("lost") ? "done" : "lost") : "won";
}

export function addStep(
  bundle: ProcessBundle,
  { kind, outcome = null, x, y }: { kind: NewStepKind; outcome?: StepOutcome | null; x: number; y: number },
): { edit: Edit; id: string } {
  const step = newStepRow(bundle, kind, kind === "end" ? (outcome ?? nextOutcome(bundle)) : null, x, y);
  return { edit: { label: `Added ${step.name}`, ops: [{ kind: "insert", steps: [step], edges: [] }] }, id: step.id };
}

/** Delete steps with every edge into or out of them; rework targets pointing at them are cleared. */
export function deleteSteps(bundle: ProcessBundle, ids: readonly string[]): Edit | null {
  const gone = new Set(ids);
  const steps = bundle.steps.filter((s) => gone.has(s.id));
  if (!steps.length) return null;
  const edges = bundle.edges.filter((e) => gone.has(e.from_step_id) || gone.has(e.to_step_id));
  const refs: RowChange[] = bundle.steps
    .filter((s) => !gone.has(s.id) && s.rework_to_step_id && gone.has(s.rework_to_step_id))
    .map((s) => ({
      table: "steps",
      id: s.id,
      before: { rework_to_step_id: s.rework_to_step_id },
      after: { rework_to_step_id: null },
    }));
  return {
    label: steps.length === 1 ? `Deleted ${steps[0]!.name}` : `Deleted ${steps.length} steps`,
    ops: [...(refs.length ? [{ kind: "update" as const, changes: refs }] : []), { kind: "remove", steps, edges }],
  };
}

export function moveSteps(bundle: ProcessBundle, positions: readonly { id: string; x: number; y: number }[]): Edit | null {
  const changes: RowChange[] = [];
  for (const p of positions) {
    const step = bundle.steps.find((s) => s.id === p.id);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!step || (Number(step.x) === x && Number(step.y) === y)) continue;
    changes.push({ table: "steps", id: step.id, before: { x: step.x, y: step.y }, after: { x, y } });
  }
  if (!changes.length) return null;
  const label = changes.length === 1 ? `Moved ${stepName(bundle, changes[0]!.id)}` : `Moved ${changes.length} steps`;
  return { label, ops: [{ kind: "update", changes }] };
}

function updateRow(bundle: ProcessBundle, table: "steps" | "edges", id: string, patch: Patch, label: string): Edit | null {
  const row = table === "steps" ? bundle.steps.find((s) => s.id === id) : bundle.edges.find((e) => e.id === id);
  if (!row) return null;
  const after: Patch = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!sameScalar(readField(row, field), value)) after[field] = value;
  }
  if (!Object.keys(after).length) return null;
  return { label, ops: [{ kind: "update", changes: [{ table, id, before: pick(row, Object.keys(after)), after }] }] };
}

/** Numbers compare by value, so "1.5" loaded from Postgres matches 1.5. */
export function sameScalar(a: Scalar, b: Scalar): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return a !== null && b !== null && a !== "" && b !== "" && Number(a) === Number(b);
  }
  return a === b;
}

export function updateStep(bundle: ProcessBundle, id: string, patch: Patch): Edit | null {
  return updateRow(bundle, "steps", id, patch, `Changed ${stepName(bundle, id)}`);
}

/** Change a step's kind; end steps get an outcome and lose it when they stop being ends. */
export function setStepKind(bundle: ProcessBundle, id: string, kind: StepKind): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return null;
  const outcome = kind === "end" ? (step.outcome ?? nextOutcome(bundle)) : null;
  return updateStep(bundle, id, { kind, outcome });
}

export type Phase = "work" | "wait";

/** Switch a duration's distribution; a new triangular range is centred on the current mean. */
export function setDistribution(bundle: ProcessBundle, id: string, phase: Phase, dist: StepRow["work_dist"]): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return null;
  const patch: Patch = { [`${phase}_dist`]: dist };
  if (dist === "triangular") {
    const range = triangularRange(step[`${phase}_params`], Number(step[`${phase}_hours`]));
    patch[`${phase}_params.min`] = round(range.min);
    patch[`${phase}_params.mode`] = round(range.mode);
    patch[`${phase}_params.max`] = round(range.max);
    patch[`${phase}_hours`] = round((range.min + range.mode + range.max) / 3);
  }
  return updateStep(bundle, id, patch);
}

/**
 * Set one point of a triangular range, moving the others as needed to keep
 * min ≤ most likely ≤ max. The mean (`*_hours`) follows, since the engine
 * samples the range and the canvas shows the mean.
 */
export function setRangePoint(
  bundle: ProcessBundle,
  id: string,
  phase: Phase,
  point: "min" | "mode" | "max",
  value: number,
): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step || !(value >= 0)) return null;
  const range = { ...triangularRange(step[`${phase}_params`], Number(step[`${phase}_hours`])), [point]: value };
  if (point === "min") {
    range.mode = Math.max(range.mode, value);
    range.max = Math.max(range.max, range.mode);
  } else if (point === "max") {
    range.mode = Math.min(range.mode, value);
    range.min = Math.min(range.min, range.mode);
  } else {
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
  }
  return updateStep(bundle, id, {
    [`${phase}_params.min`]: round(range.min),
    [`${phase}_params.mode`]: round(range.mode),
    [`${phase}_params.max`]: round(range.max),
    [`${phase}_hours`]: round((range.min + range.mode + range.max) / 3),
  });
}

/** Why an edge from `from` to `to` isn't allowed, or null if it is. `except` is an edge being rerouted. */
export function connectionProblem(bundle: ProcessBundle, from: string, to: string, except?: string): string | null {
  const source = bundle.steps.find((s) => s.id === from);
  const target = bundle.steps.find((s) => s.id === to);
  if (!source || !target) return "Connect two steps.";
  if (from === to) return "A step can't lead to itself; use its rework rate instead.";
  if (source.kind === "end") return "End steps can't lead anywhere.";
  if (target.kind === "start") return "Nothing can lead into the start step.";
  if (bundle.edges.some((e) => e.id !== except && e.from_step_id === from && e.to_step_id === to)) {
    return "Those steps are already connected.";
  }
  return null;
}

/** Sum of a step's outgoing branch probabilities. */
export function outgoingTotal(bundle: ProcessBundle, stepId: string): number {
  return bundle.edges.filter((e) => e.from_step_id === stepId).reduce((sum, e) => sum + Number(e.probability), 0);
}

/** Connect two steps. The new branch takes whatever share the step's other branches leave. */
export function addEdge(bundle: ProcessBundle, from: string, to: string): { edit: Edit; id: string } | null {
  if (connectionProblem(bundle, from, to)) return null;
  const { revision } = bundle;
  const edge: EdgeRow = {
    id: newId(),
    revision_id: revision.id,
    workspace_id: revision.workspace_id,
    process_id: revision.process_id,
    from_step_id: from,
    to_step_id: to,
    probability: Math.max(0, round(1 - outgoingTotal(bundle, from))),
    condition_tag: null,
    label: null,
  };
  const label = `Connected ${stepName(bundle, from)} to ${stepName(bundle, to)}`;
  return { edit: { label, ops: [{ kind: "insert", steps: [], edges: [edge] }] }, id: edge.id };
}

export function updateEdge(bundle: ProcessBundle, id: string, patch: Patch): Edit | null {
  const edge = bundle.edges.find((e) => e.id === id);
  if (!edge) return null;
  return updateRow(bundle, "edges", id, patch, `Changed ${stepName(bundle, edge.from_step_id)} → ${stepName(bundle, edge.to_step_id)}`);
}

/** Move an edge's ends. Its id, probability and tag stay. */
export function reconnectEdge(bundle: ProcessBundle, id: string, from: string, to: string): Edit | null {
  if (connectionProblem(bundle, from, to, id)) return null;
  const edit = updateEdge(bundle, id, { from_step_id: from, to_step_id: to });
  return edit && { ...edit, label: `Rerouted to ${stepName(bundle, to)}` };
}

export function deleteEdges(bundle: ProcessBundle, ids: readonly string[]): Edit | null {
  const gone = new Set(ids);
  const edges = bundle.edges.filter((e) => gone.has(e.id));
  if (!edges.length) return null;
  const [first] = edges;
  const label =
    edges.length === 1
      ? `Removed ${stepName(bundle, first!.from_step_id)} → ${stepName(bundle, first!.to_step_id)}`
      : `Removed ${edges.length} connections`;
  return { label, ops: [{ kind: "remove", steps: [], edges }] };
}

/** Delete what is selected: steps (with their edges) and edges, as one edit. */
export function deleteSelection(bundle: ProcessBundle, stepIds: readonly string[], edgeIds: readonly string[]): Edit | null {
  const steps = deleteSteps(bundle, stepIds);
  const covered = new Set(steps?.ops.flatMap((op) => (op.kind === "remove" ? op.edges.map((e) => e.id) : [])) ?? []);
  const edges = deleteEdges(bundle, edgeIds.filter((id) => !covered.has(id)));
  if (!steps || !edges) return steps ?? edges;
  return { label: steps.label, ops: [...steps.ops, ...edges.ops] };
}

/**
 * Problems to flag on each step, by step id: no way out, or branches not
 * adding up to 100% (the start step's one edge is followed whatever its share).
 */
export function stepWarnings(bundle: ProcessBundle): Map<string, string> {
  const out = new Map<string, string>();
  for (const step of bundle.steps) {
    if (step.kind === "end") continue;
    const outgoing = bundle.edges.filter((e) => e.from_step_id === step.id);
    if (!outgoing.length) {
      out.set(step.id, "Nothing leaves this step yet. Drag from its right edge to connect it.");
      continue;
    }
    if (step.kind === "start") continue;
    const total = outgoingTotal(bundle, step.id);
    if (Math.abs(total - 1) > TOLERANCE) {
      out.set(step.id, `Branches add up to ${Math.round(total * 1000) / 10}%, not 100%.`);
    }
  }
  return out;
}
