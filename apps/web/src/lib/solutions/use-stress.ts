"use client";

// The market stress test's runs, in their own Web Worker (issue #115, A50 slice 2). Rows arrive one condition at a time; a newer
// request (a different horizon, say) stops the one in flight.

import { useEffect, useState } from "react";
import type { EngineModel } from "@transpera-flow/engine";
import type { StressCondition, StressMessage, StressRequest, StressRow, StressTarget } from "./stress";

export type StressState = { status: "running"; rows: StressRow[] } | { status: "done"; rows: StressRow[] } | { status: "error"; rows: StressRow[]; error: string };

const DEBOUNCE_MS = 80;

export function useStress(args: { base: EngineModel | null; solved: EngineModel | null; conditions: StressCondition[]; targets: StressTarget[]; reps?: number; seed?: number }): StressState {
  const { base, solved, conditions, targets, reps = 30, seed = 1 } = args;
  const [state, setState] = useState<{ key: object | null; value: StressState }>({ key: null, value: { status: "running", rows: [] } });
  useEffect(() => {
    if (!base || !solved) return;
    const key = {};
    let worker: Worker | null = null;
    const put = (update: (s: StressState) => StressState) => setState((s) => ({ key, value: update(s.key === key ? s.value : { status: "running", rows: [] }) }));
    const timer = setTimeout(() => {
      put(() => ({ status: "running", rows: [] }));
      worker = new Worker(new URL("../../workers/stress.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<StressMessage>) => {
        const m = event.data;
        if (m.kind === "row") put((s) => ({ status: "running", rows: [...s.rows, m.row] }));
        else if (m.kind === "done") {
          put((s) => ({ status: "done", rows: s.rows }));
          worker?.terminate();
        } else {
          put((s) => ({ status: "error", rows: s.rows, error: m.error }));
          worker?.terminate();
        }
      };
      worker.onerror = (e) => put((s) => ({ status: "error", rows: s.rows, error: e.message || "The stress test failed" }));
      worker.postMessage({ id: 1, base, solved, conditions, targets, reps, seed } satisfies StressRequest);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [base, solved, conditions, targets, reps, seed]);
  return state.value;
}
