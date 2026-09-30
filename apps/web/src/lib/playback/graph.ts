import type { ProcessBundle } from "@transpera-flow/db";
import type { SimulationResult } from "@transpera-flow/engine";
import type { PlaybackGraph, PlaybackRun } from "./trace-index";

/**
 * The drawn map as playback sees it: every edge, the start step, and the end
 * step for each outcome. `toEngineModel` makes the single won and lost end
 * steps the engine's sinks, so an entity's outcome names the end it reached.
 */
export function playbackGraph(bundle: ProcessBundle): PlaybackGraph {
  const start = bundle.steps.find((s) => s.kind === "start")?.id ?? null;
  const ends: PlaybackGraph["ends"] = {};
  const servicing = bundle.process.kind === "servicing";
  for (const s of bundle.steps) {
    if (s.kind === "end" && (s.outcome === "won" || s.outcome === "lost") && !ends[s.outcome]) ends[s.outcome] = s.id;
    // A servicing task ends at its process's end, whatever the end's outcome (issue #19).
    if (servicing && s.kind === "end" && !ends.done) ends.done = s.id;
  }
  return { edges: bundle.edges.map((e) => ({ id: e.id, from: e.from_step_id, to: e.to_step_id })), start, ends };
}

/**
 * Replication 0's trace, or null when the run kept none: the items on the
 * drawn process only. A run carries the pipeline's items and every servicing
 * task (issue #19); a pipeline shows its leads, a servicing process its own
 * tasks, each ending `done` when it reaches the process's end.
 */
export function playbackRun(result: SimulationResult, process?: Pick<ProcessBundle["process"], "id" | "kind">): PlaybackRun | null {
  if (!result.trace) return null;
  const entities =
    process?.kind === "servicing"
      ? result.trace.filter((e) => e.servicing?.process === process.id).map((e) => (e.done !== undefined ? { ...e, outcome: "done" as const } : e))
      : result.trace.filter((e) => !e.servicing);
  return { entities, H: result.H, seededWip: result.initialState.kind === "wip" };
}
