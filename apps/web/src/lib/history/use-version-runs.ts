"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineModel } from "@transpera-flow/engine";
import { SimulationCancelled, SimulationClient, type WorkerLike } from "@/lib/sim/client";
import { HISTORY_REPS, HISTORY_SEED, headlineOf, type RunEntry } from "./versions";

/** A version's model, or why there isn't one. */
export type VersionModel = { model: EngineModel } | { error: string };

/**
 * Simulates published versions in the browser worker, one at a time, with the same seed and replications for each
 * so the versions compare like with like. `auto` are run straight away (newest first); any other is run when
 * `run(id)` is called, fetching its model with `loadModel` if it isn't in `models`. Results are kept per horizon:
 * changing `weeks` runs the versions again.
 */
export function useVersionRuns({
  models,
  auto,
  weeks,
  loadModel,
}: {
  models: Record<string, VersionModel>;
  auto: readonly string[];
  /** The projection length in weeks, or null for each model's own. */
  weeks: number | null;
  loadModel?: (revisionId: string) => Promise<VersionModel>;
}): { entries: Record<string, RunEntry>; run: (revisionId: string) => void } {
  const [results, setResults] = useState<Record<string, RunEntry>>({});
  const [asked, setAsked] = useState<string[]>([]);
  const [fetched, setFetched] = useState<Record<string, VersionModel>>({});
  const clientRef = useRef<SimulationClient | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const key = (id: string) => `${id}@${weeks ?? "own"}`;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  const wanted = useMemo(() => [...auto, ...asked.filter((id) => !auto.includes(id))], [auto, asked]);

  useEffect(() => {
    if (busy.current) return;
    const next = wanted.find((id) => !results[key(id)]);
    if (!next) return;
    busy.current = true;
    const k = key(next);
    void (async () => {
      // Marked running once the effect has returned, so the rows say so while it works.
      await Promise.resolve();
      if (alive.current) setResults((r) => ({ ...r, [k]: { status: "running" } }));
      let entry: RunEntry;
      let cancelled = false;
      try {
        const got = models[next] ?? fetched[next] ?? (loadModel ? await loadModel(next) : { error: "That version isn't available." });
        if (!models[next] && !fetched[next] && alive.current) setFetched((f) => ({ ...f, [next]: got }));
        if ("error" in got) {
          entry = { status: "error", message: got.error };
        } else {
          clientRef.current ??= new SimulationClient(
            () => new Worker(new URL("../../workers/simulate.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
          );
          const model = weeks === null ? got.model : { ...got.model, horizonWeeks: weeks };
          const { result } = await clientRef.current.run(model, { reps: HISTORY_REPS, seed: HISTORY_SEED });
          entry = { status: "done", headline: headlineOf(result, model) };
        }
      } catch (err) {
        cancelled = err instanceof SimulationCancelled;
        entry = { status: "error", message: err instanceof Error ? err.message : "The simulation failed." };
      }
      busy.current = false;
      if (!alive.current) return;
      // A run cut short (the page went away and came back) is tried again, not shown as a failure.
      setResults((r) => {
        const rest = { ...r };
        if (cancelled) delete rest[k];
        else rest[k] = entry;
        return rest;
      });
    })();
    // `key` closes over `weeks`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, results, models, fetched, weeks, loadModel]);

  const run = useCallback((id: string) => setAsked((a) => (a.includes(id) ? a : [...a, id])), []);
  const entries = useMemo(() => {
    const out: Record<string, RunEntry> = {};
    for (const [k, v] of Object.entries(results)) {
      const [id, w] = k.split("@");
      if (w === String(weeks ?? "own")) out[id!] = v;
    }
    return out;
  }, [results, weeks]);
  return { entries, run };
}
