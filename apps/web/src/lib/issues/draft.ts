// What the Acknowledge dialog holds while a person fills it in (issue #112, A47), and what it sends. One dialog serves
// three paths: acknowledging an insight (prefilled from it), "+ New issue" (empty) and "Edit issue" (from the issue).
// Everything here is pure: the dialog component renders it, the tests drive it.

import type { IssueLinkRef, IssueRow, SourceRow, StepRow } from "@transpera-flow/db";
import { columnProvenance, EVIDENCE_COLUMNS } from "@transpera-flow/db";
import { ratingOfStored, storedOfRating, type DetectedIssue, type Rating } from "@transpera-flow/engine";
import { MAX_TARGET } from "./validate";
import { MAX_TITLE, type SaveIssueInput } from "./validate";

/** One line on what each rating means, as the prototype words them. Worst first, as the dialog lists them. */
export const RATING_MEANINGS: Record<Rating, string> = {
  risk: "Could break delivery or lose clients. Fix now.",
  bad: "Costing time or money. Plan a fix.",
  good: "Fine today, with something to gain.",
  great: "Working well. Protect it.",
};

export const DIALOG_RATINGS: readonly Rating[] = ["risk", "bad", "good", "great"];

export type Scope = "process" | "steps";

export interface IssueDraft {
  /** The issue being edited; omitted for a new one. */
  id?: string;
  title: string;
  rating: Rating;
  /** The process the issue sits in: what "the whole process" means, and which steps can be picked. */
  processId: string | null;
  scope: Scope;
  stepIds: string[];
  ownerIds: string[];
  targetMeasure: string;
  targetNow: string;
  targetGoal: string;
  sourceIds: string[];
  /** When acknowledging: the insight it comes from, which links the two. */
  from?: SaveIssueInput["from"];
  /** Kept as found so an edit doesn't lose it. */
  evidence?: string | null;
  type?: SaveIssueInput["type"];
}

/** A step the dialog can offer, with the sources that already cite its values (they prefill an acknowledged insight's sources). */
export interface StepOption {
  id: string;
  name: string;
  processId: string | null;
  sourceIds: string[];
}

export interface IssueFormOptions {
  processes: { id: string; name: string }[];
  steps: StepOption[];
  people: { id: string; name: string }[];
  sources: { id: string; title: string }[];
}

/** The sources a step's values cite as evidence. */
export function sourcesCitedBy(step: Pick<StepRow, "provenance">): string[] {
  const out = new Set<string>();
  for (const column of EVIDENCE_COLUMNS) {
    const entry = columnProvenance(step, column);
    for (const e of entry?.evidence ?? []) if (e.source_id) out.add(e.source_id);
  }
  return [...out];
}

/** Steps as the dialog offers them (no start or end markers). */
export function stepOptions(steps: readonly StepRow[], known: readonly Pick<SourceRow, "id">[] = []): StepOption[] {
  const real = known.length ? new Set(known.map((s) => s.id)) : null;
  return steps
    .filter((s) => s.kind !== "start" && s.kind !== "end")
    .map((s) => ({ id: s.id, name: s.name, processId: s.process_id, sourceIds: sourcesCitedBy(s).filter((id) => !real || real.has(id)) }));
}

export function emptyDraft(processId: string | null, stepId = ""): IssueDraft {
  return {
    title: "",
    rating: "bad",
    processId,
    scope: stepId ? "steps" : "steps",
    stepIds: stepId ? [stepId] : [],
    ownerIds: [],
    targetMeasure: "",
    targetNow: "",
    targetGoal: "",
    sourceIds: [],
  };
}

/** Acknowledging an insight: its title and rating, the steps it touches, the sources already citing those steps, and its detection. */
export function draftFromInsight(
  insight: { title: string; rating: Rating; stepIds: string[]; detection: DetectedIssue },
  processId: string | null,
  options: Pick<IssueFormOptions, "steps">,
  scenarioId: string | null,
): IssueDraft {
  const d = insight.detection;
  const stepIds = insight.stepIds;
  const cited = new Set(stepIds.flatMap((id) => options.steps.find((s) => s.id === id)?.sourceIds ?? []));
  return {
    title: insight.title,
    rating: insight.rating,
    processId,
    // An insight on no step is about the whole process.
    scope: stepIds.length ? "steps" : "process",
    stepIds: [...stepIds],
    ownerIds: [],
    targetMeasure: "",
    targetNow: "",
    targetGoal: "",
    sourceIds: [...cited],
    evidence: d.evidence,
    type: d.type,
    from: {
      detected_key: d.key,
      evidence_metrics: d.metrics,
      role_id: d.roleId,
      person_id: d.personId,
      client_id: d.clientId ?? null,
      scenario_id: scenarioId,
    },
  };
}

/** Editing an issue: what it holds now. */
export function draftFromIssue(issue: IssueRow): IssueDraft {
  const steps = issue.links.flatMap((l) => (l.step_id ? [l.step_id] : []));
  const stepIds = steps.length ? steps : issue.step_id ? [issue.step_id] : [];
  return {
    id: issue.id,
    title: issue.title,
    rating: ratingOfStored(issue.severity),
    processId: issue.links.find((l) => l.process_id)?.process_id ?? issue.process_id,
    scope: stepIds.length ? "steps" : "process",
    stepIds,
    ownerIds: issue.owner_ids.length ? [...issue.owner_ids] : issue.owner_person_id ? [issue.owner_person_id] : [],
    targetMeasure: issue.target_measure ?? "",
    targetNow: issue.target_now ?? "",
    targetGoal: issue.target_goal ?? "",
    sourceIds: [...issue.source_ids],
    evidence: issue.evidence,
  };
}

export interface DraftErrors {
  title?: string;
  steps?: string;
  process?: string;
}

/** What is missing: a title, and at least one step when the scope is steps (a whole-process scope needs a process). */
export function validateDraft(d: IssueDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!d.title.trim()) errors.title = "Give the issue a title.";
  else if (d.title.trim().length > MAX_TITLE) errors.title = `Keep the title to ${MAX_TITLE} characters.`;
  if (d.scope === "steps" && d.stepIds.length === 0) errors.steps = "Pick at least one step, or choose the whole process.";
  if (d.scope === "process" && !d.processId) errors.process = "Pick the process it is in.";
  for (const [k, v] of [["targetMeasure", d.targetMeasure], ["targetNow", d.targetNow], ["targetGoal", d.targetGoal]] as const) {
    if (v.trim().length > MAX_TARGET) errors.title ??= `Keep the target ${k === "targetMeasure" ? "measure" : k === "targetNow" ? "value" : "goal"} to ${MAX_TARGET} characters.`;
  }
  return errors;
}

export const hasErrors = (e: DraftErrors): boolean => Object.keys(e).length > 0;

/** What the dialog sends. The steps' process is looked up from the options, so a step in a nested process keeps its own. */
export function toSaveInput(d: IssueDraft, options: Pick<IssueFormOptions, "steps">): SaveIssueInput {
  const processOf = new Map(options.steps.map((s) => [s.id, s.processId]));
  const links: IssueLinkRef[] =
    d.scope === "process"
      ? [{ process_id: d.processId, step_id: null }]
      : d.stepIds.map((id) => ({ process_id: processOf.get(id) ?? d.processId, step_id: id }));
  const blank = (v: string) => v.trim() || null;
  return {
    ...(d.id ? { id: d.id } : {}),
    title: d.title.trim(),
    severity: storedOfRating(d.rating),
    ...(d.type ? { type: d.type } : {}),
    evidence: d.evidence ?? null,
    target_measure: blank(d.targetMeasure),
    target_now: blank(d.targetNow),
    target_goal: blank(d.targetGoal),
    links,
    owner_ids: d.ownerIds,
    source_ids: d.sourceIds,
    ...(d.from && !d.id ? { from: d.from } : {}),
  };
}

/** Toggle an id in a list, keeping the order it was added in. */
export const toggle = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
