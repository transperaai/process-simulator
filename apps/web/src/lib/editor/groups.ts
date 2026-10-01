// Editor commands for placing steps and grouping them (issue #104, on the nesting of issue #102). Pure, like
// ./commands.ts: each returns an Edit (or null, or a plain-English problem) against the process as the editor shows it.
//
// Saves go row by row, and the database checks a group's shape at each commit, so the order of the operations in an
// edit matters: a group is written empty first, its steps are moved in, and only then is its first step set (a first
// step must already be one of the group's own steps). Ungrouping runs the other way round.

import { ancestorsOf, groupHasExit, isGroup, type EdgeRow, type ProcessBundle, type StepRow } from "@transpera-flow/db";
import { GROUP_PADDING } from "@/lib/map/groups";
import { newId, newStepRow, type NewStepKind } from "./commands";
import type { Edit, Op, Patch, RowChange } from "./ops";

/** What the palette can add. */
export type PaletteKind = NewStepKind | "group";

/** A step card's rough size on the map, to find a free place for a new one. */
const SLOT = { x: 240 };

const stepOf = (bundle: ProcessBundle, id: string) => bundle.steps.find((s) => s.id === id);

export function edgeRow(bundle: ProcessBundle, from: string, to: string, probability: number): EdgeRow {
  const { revision } = bundle;
  return {
    id: newId(),
    revision_id: revision.id,
    workspace_id: revision.workspace_id,
    process_id: revision.process_id,
    from_step_id: from,
    to_step_id: to,
    probability,
    condition_tag: null,
    label: null,
  };
}

/** A group: a box with no work of its own (the database refuses a role, hours or rework on one). */
export function groupRow(bundle: ProcessBundle, x: number, y: number, parent: string | null): StepRow {
  return {
    ...newStepRow(bundle, "task", null, x, y),
    name: "New group",
    kind: "group",
    work_hours: 0,
    wait_hours: 0,
    parent_step_id: parent,
  };
}

/** The first spot at or below (x, y) with no step of the same group on it. */
export function freeSpot(bundle: ProcessBundle, parent: string | null, x: number, y: number): { x: number; y: number } {
  const taken = (py: number) =>
    bundle.steps.some((s) => (s.parent_step_id ?? null) === parent && Math.abs(Number(s.x) - x) < 180 && Math.abs(Number(s.y) - py) < 90);
  for (let i = 0; i < 20 && taken(y); i++) y += 60;
  return { x, y };
}

/**
 * Add a step, decision, wait or group after the selected step, in the same group as it (so inside a nested group, the new
 * one lands inside it). The new one is joined in: a selected step with nothing after it leads to it, and one with a
 * single next step now leads to the new one, which leads on to that step. A step with branches, or an end step, gets
 * the new one placed beside it, unconnected. With nothing selected, it goes at the end of the top level.
 */
export function addAfter(bundle: ProcessBundle, selectedId: string | null, kind: PaletteKind): { edit: Edit; id: string; note?: string } {
  const sel = selectedId ? stepOf(bundle, selectedId) : undefined;
  const parent = sel ? (sel.parent_step_id ?? null) : null;
  const siblings = bundle.steps.filter((s) => (s.parent_step_id ?? null) === parent);
  const outgoing = sel && sel.kind !== "end" ? bundle.edges.filter((e) => e.from_step_id === sel.id) : [];
  const branches = outgoing.length > 1;
  // After a step with branches the right is crowded: put the new one just below it, where it is easy to find.
  const x0 = sel ? Number(sel.x) + (branches ? 0 : SLOT.x) : siblings.reduce((m, s) => Math.max(m, Number(s.x) + SLOT.x), 0);
  const y0 = sel ? Number(sel.y) + (branches ? 120 : 0) : siblings.length ? Number(siblings[siblings.length - 1]!.y) : 0;
  const { x, y } = freeSpot(bundle, parent, x0, y0);

  let added: StepRow;
  const extra: StepRow[] = [];
  if (kind === "group") {
    added = groupRow(bundle, x, y, parent);
    // A group starts with one step, so it can be simulated and opened to edit.
    const first: StepRow = { ...newStepRow(bundle, "task", null, GROUP_PADDING.left, GROUP_PADDING.top), parent_step_id: added.id };
    added = { ...added, entry_step_id: first.id };
    extra.push(first);
  } else {
    added = { ...newStepRow(bundle, kind, null, x, y), parent_step_id: parent };
  }

  const ops: Op[] = [];
  const out = sel && sel.kind !== "end" ? bundle.edges.filter((e) => e.from_step_id === sel.id) : null;
  if (sel && out && out.length === 0) {
    ops.push({ kind: "insert", steps: [added, ...extra], edges: [edgeRow(bundle, sel.id, added.id, 1)] });
  } else if (sel && out && out.length === 1) {
    const next = out[0]!;
    // sel -> new keeps the old connection's share and tag; new -> next carries on at 100%.
    ops.push({ kind: "insert", steps: [added, ...extra], edges: [edgeRow(bundle, added.id, next.to_step_id, 1)] });
    ops.push({ kind: "update", changes: [{ table: "edges", id: next.id, before: { to_step_id: next.to_step_id }, after: { to_step_id: added.id } }] });
  } else {
    ops.push({ kind: "insert", steps: [added, ...extra], edges: [] });
  }
  const note = sel && branches ? `${sel.name} has branches: connect the new step yourself.` : sel?.kind === "end" ? `${sel.name} is an end step, so nothing leads on from it: connect the new step yourself.` : undefined;
  return { edit: { label: `Added ${added.name}`, ops }, id: added.id, ...(note ? { note } : {}) };
}

/** Steps to group: those picked that aren't inside another picked group (it takes them along). */
function topmost(bundle: ProcessBundle, ids: readonly string[]): StepRow[] {
  const picked = new Set(ids);
  const byId = new Map(bundle.steps.map((s) => [s.id, s]));
  return bundle.steps.filter((s) => picked.has(s.id) && !ancestorsOf(s.id, byId).some((g) => picked.has(g)));
}

/** Why the picked steps can't be grouped, or null if they can. */
export function groupProblem(bundle: ProcessBundle, ids: readonly string[]): string | null {
  const steps = topmost(bundle, ids);
  if (!steps.length) return "Select the steps you want to put in a group.";
  if (steps.some((s) => s.kind === "start" || s.kind === "end")) return "The start and end steps stay outside groups.";
  if (new Set(steps.map((s) => s.parent_step_id ?? null)).size > 1) return "Pick steps that sit in the same place (all at the top level, or all in the same group).";
  return null;
}

/**
 * Put the picked steps in a new group, with a box drawn around where they are. Connections are left as they are. The
 * group's first step is the one the outside leads into (else the leftmost). If one of them was the first step of the
 * group they sit in, the new group takes that place.
 */
export function groupSteps(bundle: ProcessBundle, ids: readonly string[]): { edit: Edit; id: string } | null {
  if (groupProblem(bundle, ids)) return null;
  const steps = topmost(bundle, ids);
  const members = new Set(steps.map((s) => s.id));
  const parent = steps[0]!.parent_step_id ?? null;
  const gx = Math.round(Math.min(...steps.map((s) => Number(s.x))) - GROUP_PADDING.left);
  const gy = Math.round(Math.min(...steps.map((s) => Number(s.y))) - GROUP_PADDING.top);
  const group = groupRow(bundle, gx, gy, parent);

  const fromOutside = new Set(bundle.edges.filter((e) => members.has(e.to_step_id) && !members.has(e.from_step_id)).map((e) => e.to_step_id));
  const leftmost = (list: StepRow[]) => [...list].sort((a, b) => Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y))[0]!;
  const entered = steps.filter((s) => fromOutside.has(s.id));
  const entry = leftmost(entered.length ? entered : steps);

  const ops: Op[] = [{ kind: "insert", steps: [group], edges: [] }];
  const holder = parent ? stepOf(bundle, parent) : undefined;
  if (holder && holder.entry_step_id && members.has(holder.entry_step_id)) {
    ops.push({ kind: "update", changes: [{ table: "steps", id: holder.id, before: { entry_step_id: holder.entry_step_id }, after: { entry_step_id: group.id } }] });
  }
  ops.push({
    kind: "update",
    changes: steps.map((s): RowChange => ({
      table: "steps",
      id: s.id,
      before: { parent_step_id: s.parent_step_id ?? null, x: s.x, y: s.y },
      after: { parent_step_id: group.id, x: Math.round(Number(s.x) - gx), y: Math.round(Number(s.y) - gy) },
    })),
  });
  ops.push({ kind: "update", changes: [{ table: "steps", id: group.id, before: { entry_step_id: null }, after: { entry_step_id: entry.id } }] });
  return { edit: { label: steps.length === 1 ? `Grouped ${steps[0]!.name}` : `Grouped ${steps.length} steps`, ops }, id: group.id };
}

/** The steps directly inside a group, left to right. */
export function membersOf(bundle: ProcessBundle, groupId: string): StepRow[] {
  return bundle.steps.filter((s) => s.parent_step_id === groupId).sort((a, b) => Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y));
}

/** Choose which of a group's own steps the process enters it at. */
export function setGroupEntry(bundle: ProcessBundle, groupId: string, stepId: string): Edit | null {
  const group = stepOf(bundle, groupId);
  const step = stepOf(bundle, stepId);
  if (!group || !isGroup(group) || !step || step.parent_step_id !== groupId || group.entry_step_id === stepId) return null;
  return {
    label: `Made ${step.name} the first step of ${group.name}`,
    ops: [{ kind: "update", changes: [{ table: "steps", id: groupId, before: { entry_step_id: group.entry_step_id ?? null }, after: { entry_step_id: stepId } }] }],
  };
}

/**
 * Dissolve a group: its steps move up to where the group sits, and the group's connections go to them (into the
 * group: to its first step; out of it: from each step that had nowhere else to go).
 */
export function ungroup(bundle: ProcessBundle, groupId: string): Edit | null {
  const group = stepOf(bundle, groupId);
  if (!group || !isGroup(group)) return null;
  const members = membersOf(bundle, groupId);
  const parent = group.parent_step_id ?? null;
  const holder = parent ? stepOf(bundle, parent) : undefined;
  const entry = members.find((m) => m.id === group.entry_step_id) ?? members[0];
  const ops: Op[] = [];
  if (group.entry_step_id) {
    ops.push({ kind: "update", changes: [{ table: "steps", id: groupId, before: { entry_step_id: group.entry_step_id }, after: { entry_step_id: null } }] });
  }
  if (members.length) {
    ops.push({
      kind: "update",
      changes: members.map((m): RowChange => ({
        table: "steps",
        id: m.id,
        before: { parent_step_id: groupId, x: m.x, y: m.y },
        after: { parent_step_id: parent, x: Math.round(Number(m.x) + Number(group.x)), y: Math.round(Number(m.y) + Number(group.y)) },
      })),
    });
  }
  if (holder && holder.entry_step_id === groupId && entry) {
    ops.push({ kind: "update", changes: [{ table: "steps", id: holder.id, before: { entry_step_id: groupId }, after: { entry_step_id: entry.id } }] });
  }

  const into = bundle.edges.filter((e) => e.to_step_id === groupId);
  const outOf = bundle.edges.filter((e) => e.from_step_id === groupId);
  const retargeted: RowChange[] = entry
    ? into.map((e) => ({ table: "edges" as const, id: e.id, before: { to_step_id: groupId } as Patch, after: { to_step_id: entry.id } as Patch }))
    : [];
  const tails = members.filter(
    (m) => m.kind !== "end" && !bundle.edges.some((e) => e.from_step_id === m.id) && !(isGroup(m) && groupHasExit(bundle.steps, bundle.edges, m.id)),
  );
  const rerouted = outOf.flatMap((e) => tails.map((t) => ({ ...edgeRow(bundle, t.id, e.to_step_id, Number(e.probability)), condition_tag: e.condition_tag, label: e.label })));
  if (retargeted.length) ops.push({ kind: "update", changes: retargeted });
  if (rerouted.length) ops.push({ kind: "insert", steps: [], edges: rerouted });
  // Connections into a group with no step to go to, and the group's own, go with it.
  // The row is removed with no first step (it was cleared above), so undo can bring it back before its steps move in.
  ops.push({ kind: "remove", steps: [{ ...group, entry_step_id: null }], edges: [...(entry ? [] : into), ...outOf] });
  return { label: `Ungrouped ${group.name}`, ops };
}
