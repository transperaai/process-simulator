// The market stress test (issue #115, A50 slice 2): the solution, and the version it was copied from, run under each market condition on
// its own (the engine's `withMarketCondition`), with each issue's target checked by the same goal reading and verdict as the Editor
// and the server (verdict.ts). Pure and synchronous: the Web Worker (workers/stress.worker.ts) calls it, so the page stays responsive.

import { simulate, withMarketCondition, type EngineModel, type MarketFactors } from "@transpera-flow/engine";
import { mrrAfter, summarise } from "@/lib/overview/projection";
import { checkTarget } from "./verdict";

export type StressResult = "pass" | "fail" | "unchecked";

export interface StressCondition {
  /** The condition's id (a preset's key when the workspace has no rows). */
  key: string;
  name: string;
  /** boom, stable, soft or downturn for a preset; null for your own. */
  preset: string | null;
  factors: MarketFactors;
}

/** An issue the solution solves: what its verdict reads. */
export interface StressTarget {
  issueId: string;
  number: number | null;
  title: string;
  target: { measure: string | null; goal: string | null };
  /** The steps of the solution's map the verdict reads. */
  area: string[];
}

export interface StressVerdict {
  issueId: string;
  status: StressResult;
  /** Share of runs that meet the goal, 0 to 100; null when not checked. */
  holdsPct: number | null;
  /** What it was checked against, in words. */
  note: string;
}

/** One market's outcome. */
export interface StressRow {
  key: string;
  name: string;
  preset: string | null;
  verdicts: StressVerdict[];
  /** Recurring revenue at the horizon, on average: the version the solution was copied from, and the solution. */
  mrr: { live: number; solution: number };
}

export interface StressRequest {
  id: number;
  /** The version the solution was copied from. */
  base: EngineModel;
  solved: EngineModel;
  conditions: StressCondition[];
  targets: StressTarget[];
  reps: number;
  seed: number;
}

export type StressMessage = { id: number; kind: "row"; row: StressRow } | { id: number; kind: "done" } | { id: number; kind: "error"; error: string };

/** Run every condition in turn, handing each row to `emit` as soon as it is worked out. */
export function runStress(req: Pick<StressRequest, "base" | "solved" | "conditions" | "targets" | "reps" | "seed">, emit: (row: StressRow) => void): void {
  for (const c of req.conditions) {
    const base = withMarketCondition(req.base, c.factors);
    const solved = withMarketCondition(req.solved, c.factors);
    const baseResult = simulate(base, req.reps, req.seed);
    const solvedResult = simulate(solved, req.reps, req.seed);
    const verdicts = req.targets.map((t): StressVerdict => {
      const v = checkTarget({ target: t.target, model: solved, result: solvedResult, area: t.area });
      return v.status === "unchecked" ? { issueId: t.issueId, status: "unchecked", holdsPct: null, note: v.note } : { issueId: t.issueId, status: v.status, holdsPct: v.holdsPct, note: v.note };
    });
    emit({
      key: c.key,
      name: c.name,
      preset: c.preset,
      verdicts,
      mrr: { live: mrrAfter(base, summarise(base, baseResult)).mean, solution: mrrAfter(solved, summarise(solved, solvedResult)).mean },
    });
  }
}
