"use client";

// The market stress test's runs, in their own Web Worker (issue #115, A50 slice 2). Rows arrive one condition at a time; a newer
// request (a different horizon, say) stops the one in flight and clears its rows. What starts a run is the content of the request, not
// the identity of the arrays it was built from, so a re-render (a verdict button pressed on the page, say) never restarts it.

import { useEffect, useRef, useState } from "react";
import type { EngineModel } from "@transpera-flow/engine";
import { stressKey, type StressCondition, type StressMessage, type StressRequest, type StressRow, type StressTarget } from "./stress";

export type StressState = { status: "running"; rows: StressRow[] } | { status: "done"; rows: StressRow[] } | { status: "error"; rows: StressRow[]; error: string };

const DEBOUNCE_MS = 80;
const WAITING: StressState = { status: "running", rows: [] };

interface Held {
  base: EngineModel | null;
  solved: EngineModel | null;
  key: string;
  value: StressState;
}

export function useStress(args: { base: EngineModel | null; solved: EngineModel | null; conditions: StressCondition[]; targets: StressTarget[]; reps?: number; seed?: number }): StressState {
  const { base, solved, conditions, targets, reps = 30, seed = 1 } = args;
  const key = `${stressKey(targets, conditions)}|${reps}|${seed}`;
  const latest = useRef({ conditions, targets });
  useEffect(() => {
    latest.current = { conditions, targets };
  });
  const [held, setHeld] = useState<Held>({ base: null, solved: null, key: "", value: WAITING });

  useEffect(() => {
    if (!base || !solved) return;
    let worker: Worker | null = null;
    const put = (update: (s: StressState) => StressState) =>
      setHeld((h) => {
        const mine = h.base === base && h.solved === solved && h.key === key;
        return { base, solved, key, value: update(mine ? h.value : WAITING) };
      });
    const timer = setTimeout(() => {
      put(() => WAITING);
      const stop = () => {
        worker?.terminate();
        worker = null;
      };
      worker = new Worker(new URL("../../workers/stress.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<StressMessage>) => {
        const m = event.data;
        if (m.kind === "row") put((s) => ({ status: "running", rows: [...s.rows, m.row] }));
        else if (m.kind === "done") {
          put((s) => ({ status: "done", rows: s.rows }));
          stop();
        } else {
          put((s) => ({ status: "error", rows: s.rows, error: m.error }));
          stop();
        }
      };
      worker.onerror = (e) => {
        put((s) => ({ status: "error", rows: s.rows, error: e.message || "The stress test failed" }));
        stop();
      };
      worker.postMessage({ id: 1, base, solved, ...latest.current, reps, seed } satisfies StressRequest);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [base, solved, key, reps, seed]);

  // Rows from an older request are not shown against a newer one.
  return held.base === base && held.solved === solved && held.key === key ? held.value : WAITING;
}
