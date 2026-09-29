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
  for (const s of bundle.steps) {
    if (s.kind === "end" && (s.outcome === "won" || s.outcome === "lost") && !ends[s.outcome]) ends[s.outcome] = s.id;
  }
  return { edges: bundle.edges.map((e) => ({ id: e.id, from: e.from_step_id, to: e.to_step_id })), start, ends };
}

/** Replication 0's trace, or null when the run kept none. */
export function playbackRun(result: SimulationResult): PlaybackRun | null {
  if (!result.trace) return null;
  return { entities: result.trace, H: result.H, seededWip: result.initialState.kind === "wip" };
}
