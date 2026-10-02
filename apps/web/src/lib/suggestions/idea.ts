// A solution idea as a map (A52 slice 2): the proposed steps become a block, so the Suggestions card can draw them with the
// block library's picture and the Editor can put them in with the same commands as a library block (insert, or replace the
// step the idea would replace). Pure: no I/O.

import type { BlockBundle, BlockEdge, BlockStep, ProcessBundle, ProposalRow, SolutionIdeaPayload } from "@transpera-flow/db";
import { insertBlock, replaceProblem, replaceWithBlock } from "@/lib/blocks/blocks";
import type { Edit } from "@/lib/editor/ops";
import { solutionEditorHref } from "@/lib/solutions/links";

/** The kinds a block can hold. Anything else an idea names (a start or end step, a made-up kind) becomes a task. */
const BLOCK_KINDS = ["task", "wait", "decision"] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];

/** How far apart the steps sit on the map, left to right, as the Editor's own default spacing. */
const GAP = 240;

/**
 * The idea's steps as a block: one step each, in the order given, joined by the idea's edges (a chain when it gave none).
 * `roles` names the workspace's roles so a step's `role` ("Sales") becomes that role's id; a role that isn't there is left
 * unset. An AI step is a task that takes a few minutes and says so in its tool.
 */
export function ideaToBlock(payload: SolutionIdeaPayload, roles: readonly { id: string; name: string }[] = []): BlockBundle {
  const steps: BlockStep[] = payload.steps.map((s, i) => {
    const kind: BlockKind = (BLOCK_KINDS as readonly string[]).includes(s.kind ?? "") ? (s.kind as BlockKind) : "task";
    const role = s.role ? roles.find((r) => r.name.trim().toLowerCase() === s.role!.trim().toLowerCase()) : undefined;
    return {
      id: s.key,
      name: s.name,
      kind,
      outcome: null,
      role_id: role?.id ?? null,
      person_id: null,
      work_hours: kind === "task" ? (s.ai ? 0.1 : 1) : 0,
      work_dist: "lognormal",
      work_params: {},
      wait_hours: kind === "wait" ? 8 : 0,
      wait_dist: "lognormal",
      wait_params: {},
      rework_rate: 0,
      rework_to_step_id: null,
      tool: s.ai ? "AI" : null,
      notes: s.ai ? "Proposed by AI. Check the time it takes." : null,
      sla_hours: null,
      expected_wait_hours: null,
      lost_per_day_waiting: null,
      dropoff_benchmark: null,
      target_cycle_hours: null,
      current_wip: null,
      x: i * GAP,
      y: 0,
      parent_step_id: null,
      entry_step_id: null,
      child_process_id: null,
      assumption: s.ai === true,
      conflict: false,
      provenance: {},
    };
  });
  const known = new Set(steps.map((s) => s.id));
  const pairs = (payload.edges ?? steps.slice(1).map((s, i) => ({ from: steps[i]!.id, to: s.id }))).filter((e) => known.has(e.from) && known.has(e.to));
  const edges: BlockEdge[] = pairs.map((e, i) => ({ id: `e${i + 1}`, from_step_id: e.from, to_step_id: e.to, probability: 1, condition_tag: null, label: null }));
  return { steps, edges, entry_step_id: steps[0]?.id ?? null };
}

/** What the Editor needs to place an idea: its name and map, and the live step it would replace (the first named). */
export interface IdeaSeed {
  id: string;
  title: string;
  block: BlockBundle;
  /** Step ids the idea would replace. */
  replaces: string[];
}

export function ideaSeed(p: Pick<ProposalRow, "id" | "title" | "payload">, roles: readonly { id: string; name: string }[] = []): IdeaSeed {
  const payload = p.payload as SolutionIdeaPayload;
  return { id: p.id, title: p.title, block: ideaToBlock(payload, roles), replaces: payload.replaces_step_ids ?? [] };
}

/**
 * "✎ Build it": the Editor in solution mode on the issue's process, for that issue, with the idea's steps placed. Null when
 * the issue names no process (there is no map to open).
 */
export function buildIdeaHref(base: string, p: Pick<ProposalRow, "id" | "issue_id">, issue: { processId?: string | null } | undefined, from: string): string | null {
  if (!p.issue_id || !issue?.processId) return null;
  return solutionEditorHref(base, issue.processId, { issueId: p.issue_id, idea: p.id, from });
}

/** Where an idea's steps go in the solution's copy of the map, and what to tell the person about it. */
export interface IdeaPlacement {
  edit: Edit;
  /** The group the steps arrive in, to select. */
  id: string;
  note: string;
}

/**
 * Put an idea's steps into `bundle` (the live map, which a solution starts as a copy of): in place of the first step the idea would
 * replace that can be replaced, else at the end of the map. Pure, so the Editor can work it out before it draws anything. Null when
 * the idea has no steps to place.
 */
export function placeIdea(bundle: ProcessBundle, idea: IdeaSeed): IdeaPlacement | null {
  const target = idea.replaces.find((id) => bundle.steps.some((s) => s.id === id) && !replaceProblem(bundle, id)) ?? null;
  const made = target ? replaceWithBlock(bundle, target, idea.block, idea.title) : insertBlock(bundle, null, idea.block, idea.title);
  if (!made) return null;
  const notes = [
    "The AI's steps are placed. Adjust them, simulate, then save.",
    target ? null : "Nothing in the map is marked as replaced, so the steps sit at the end: connect them where they belong.",
    target && idea.replaces.length > 1 ? "The idea names more than one step to replace. The first is replaced; the others are still there." : null,
    made.note ?? null,
  ];
  return { edit: made.edit, id: made.id, note: notes.filter(Boolean).join(" ") };
}
