"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ProcessBundle } from "@transpera-flow/db";
import type { SimulationResult } from "@transpera-flow/engine";
import { PlaybackClock, formatSimTime, maxHopHours } from "./clock";
import { playbackGraph, playbackRun } from "./graph";
import { PlaybackIndex, type PlaybackGraph } from "./trace-index";

/** A step that playback labels: a working step's queue, or how many reached an end. */
export interface PlaybackStep {
  id: string;
  name: string;
  kind: "work" | "end";
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Playback of the latest run on the map (issue #14): one clock for the map's
 * lifetime, and an index over the run's trace, rebuilt when the run or the map
 * changes. Playback and editing coexist: any edit pauses playback where it is,
 * and the re-run that follows is shown from the same time.
 */
export function usePlayback(bundle: ProcessBundle, result: SimulationResult | null) {
  const hoursPerWeek = bundle.workspace.settings.hours_per_week;
  const [clock] = useState(() => new PlaybackClock());
  const state = useSyncExternalStore(clock.subscribe, clock.getState, clock.getState);
  const reducedMotion = usePrefersReducedMotion();

  const processId = bundle.process.id;
  const processKind = bundle.process.kind;
  const run = useMemo(() => (result ? playbackRun(result, { id: processId, kind: processKind }) : null), [result, processId, processKind]);
  // Rebuilt only when the edges or end steps change, not when a step moves.
  const graphKey = JSON.stringify(playbackGraph(bundle));
  const graph = useMemo(() => JSON.parse(graphKey) as PlaybackGraph, [graphKey]);
  const index = useMemo(
    () => (run ? new PlaybackIndex(run, graph, { maxHop: maxHopHours(hoursPerWeek) }) : null),
    [run, graph, hoursPerWeek],
  );
  useEffect(() => {
    if (run) clock.configure({ H: run.H, hoursPerWeek });
  }, [clock, run, hoursPerWeek]);

  // An edit pauses playback (it keeps its time).
  useEffect(() => {
    clock.pause();
  }, [clock, bundle]);

  const steps = useMemo(
    () =>
      bundle.steps
        .filter((s) => s.kind !== "start")
        .map((s): PlaybackStep => ({ id: s.id, name: s.name, kind: s.kind === "end" ? "end" : "work" })),
    [bundle.steps],
  );

  /** What a screen reader hears about the map at a time. */
  const describe = useCallback(
    (t: number) => {
      if (!index) return "";
      const queues = steps
        .filter((s) => s.kind === "work")
        .map((s) => [s.name, index.queuedAt(s.id, t)] as const)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name} ${n}`);
      const ends = steps
        .filter((s) => s.kind === "end")
        .map((s) => `${s.name} ${index.endedBy(s.id, t)}`);
      return [
        formatSimTime(t, hoursPerWeek, t >= index.H),
        queues.length ? `Queued: ${queues.join(", ")}` : "Nothing queued",
        ends.length ? `Reached so far: ${ends.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    },
    [index, steps, hoursPerWeek],
  );

  return {
    clock,
    index,
    steps,
    hoursPerWeek,
    reducedMotion,
    describe,
    /** The bottleneck pulses while playback plays. */
    pulsing: state.playing,
  };
}
