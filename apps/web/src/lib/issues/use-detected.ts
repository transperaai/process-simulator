"use client";

// The issues a run detects, with their cost per month (issue #108). Most costs
// come straight from the run; the "too busy" cost needs the extra run behind the
// shadow price (what one more person in the role would bring), so the issues
// show first without it and again, costed, once a worker has run it.

import { useEffect, useMemo, useState } from "react";
import { detectIssues, type DetectedIssue, type EngineModel, type SimulationResult } from "@transpera-flow/engine";

export interface IssueCostsRequest {
  id: number;
  model: EngineModel;
  roleIds: string[];
  reps: number;
  seed: number;
}

export type IssueCostsResponse = { id: number; ok: true; value: Record<string, number> } | { id: number; ok: false; error: string };

/** The roles whose capacity issues need a shadow price to be costed. */
export function costedRoleIds(issues: readonly DetectedIssue[]): string[] {
  return [...new Set(issues.filter((i) => i.key.startsWith("capacity:") && i.roleId).map((i) => i.roleId!))].sort();
}

const DEBOUNCE_MS = 250;

/** `detectIssues` for a run, then again with the shadow prices of the roles it flags. Null until there is a run. */
export function useDetectedIssues(model: EngineModel | null, result: SimulationResult | null, currency: string): DetectedIssue[] | null {
  const first = useMemo(() => (model && result ? detectIssues(model, result, {}, { cost: { currency } }) : null), [model, result, currency]);
  const roleIds = useMemo(() => (first ? costedRoleIds(first) : []), [first]);
  const [prices, setPrices] = useState<{ model: EngineModel; result: SimulationResult; value: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!model || !result || !roleIds.length) return;
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      worker = new Worker(new URL("../../workers/issue-costs.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<IssueCostsResponse>) => {
        if (event.data.ok) setPrices({ model, result, value: event.data.value });
        worker?.terminate();
      };
      // Without the extra run the issues keep the costs they have; nothing to report.
      worker.onerror = () => worker?.terminate();
      worker.postMessage({ id: 1, model, roleIds, reps: result.reps, seed: result.seed } satisfies IssueCostsRequest);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [model, result, roleIds]);

  return useMemo(() => {
    if (!model || !result || !first) return first;
    return prices && prices.model === model && prices.result === result ? detectIssues(model, result, {}, { cost: { currency }, shadowPrices: prices.value }) : first;
  }, [model, result, first, prices, currency]);
}
