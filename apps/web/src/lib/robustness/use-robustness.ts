"use client";

import { useEffect, useMemo, useState } from "react";
import { RobustnessCancelled, hashString, stableStringify, type PoolWorker, type RobustnessProgress, type RobustnessResult } from "@transpera-flow/engine";
import { RobustnessSession, type RobustnessRequestInput } from "./session";

export type RobustnessState =
  | { status: "idle" }
  | { status: "running"; progress: RobustnessProgress | null }
  | { status: "done"; result: RobustnessResult; fromCache: boolean; durationMs: number | null }
  | { status: "cancelled" }
  | { status: "error"; error: string };

const createWorker = () => new Worker(new URL("../../workers/robustness.worker.ts", import.meta.url), { type: "module" }) as unknown as PoolWorker;

/**
 * The robustness check for one comparison. Nothing runs until `start`; a
 * result already in this tab's cache for the same model, scenario and options
 * is shown straight away. Changing the input cancels a running check. Pass a
 * memoised input: its identity decides when the cache is looked up again.
 */
export function useRobustness(input: RobustnessRequestInput | null): {
  state: RobustnessState;
  start: () => void;
  cancel: () => void;
} {
  const [session] = useState(() => new RobustnessSession(createWorker));
  const key = useMemo(() => (input ? hashString(stableStringify(input)) : null), [input]);
  const [runState, setRunState] = useState<{ key: string; state: RobustnessState } | null>(null);

  useEffect(() => () => session.dispose(), [session]);
  // A different comparison: stop checking the old one.
  useEffect(() => () => session.cancel(), [session, key]);

  // Cached results (the tab's cache) for this exact input, without running anything.
  const cached = useMemo(() => (input ? session.cached(input) : null), [session, input]);

  let state: RobustnessState = { status: "idle" };
  if (runState && runState.key === key) state = runState.state;
  else if (cached) state = { status: "done", result: cached, fromCache: true, durationMs: null };

  const start = () => {
    if (!input || !key) return;
    const started = performance.now();
    setRunState({ key, state: { status: "running", progress: null } });
    session
      .run(input, (progress) => setRunState((s) => (s?.key === key && s.state.status === "running" ? { key, state: { status: "running", progress } } : s)))
      .then((result) =>
        setRunState((s) =>
          s?.key === key ? { key, state: { status: "done", result, fromCache: result.stats.cached === result.stats.jobs, durationMs: performance.now() - started } } : s,
        ),
      )
      .catch((err: Error) =>
        setRunState((s) =>
          s?.key === key ? { key, state: err instanceof RobustnessCancelled ? { status: "cancelled" } : { status: "error", error: err.message } } : s,
        ),
      );
  };

  return { state, start, cancel: () => session.cancel() };
}
