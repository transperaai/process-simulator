// What the Solution page's comparison needs (issue #115, A50 slice 2), as pure functions: the solution's map set against the version it
// was copied from, the groups to open, the market conditions to stress it under, and the targets of the issues it solves.

import { ancestorsOf, type IssueRow, type MarketConditionRow, type ProcessBundle, type SolutionIssueRow, type SolutionRow } from "@transpera-flow/db";
import { MARKET_PRESETS, factorsFromPercents, type MarketFactors, type MarketPresetKey } from "@transpera-flow/engine";
import { diffBundles, type DraftDiff } from "@/lib/drafts/diff";
import { orderConditions } from "@/lib/market";
import { solutionIssueOf, verdictArea } from "./area";
import { bundleFromSolution } from "./bundle";
import type { StressCondition, StressResult, StressTarget } from "./stress";

/**
 * The two maps: `base` (the version of the process the solution was copied from) and the solution's copy of it, with the changes
 * between them and the groups to open so the changes are in view.
 */
export interface Comparison {
  base: ProcessBundle;
  solved: ProcessBundle;
  diff: DraftDiff;
  /** Steps the copy added or changed, by id. */
  changed: string[];
  /** Groups to open on both maps at first: every ancestor of a changed step, in the copy and in the base. */
  open: ReadonlySet<string>;
}

export function compareMaps(base: ProcessBundle, solution: Pick<SolutionRow, "steps">): Comparison {
  const solved = bundleFromSolution(base, solution);
  const diff = diffBundles(base, solved);
  const changed = [...diff.steps.values()].filter((c) => c.kind !== "removed").map((c) => c.id);
  const byId = new Map([...base.steps, ...solved.steps].map((s) => [s.id, s]));
  const open = new Set<string>();
  for (const id of [...diff.steps.keys()]) for (const a of ancestorsOf(id, byId)) open.add(a);
  return { base, solved, diff, changed, open };
}

/**
 * The market conditions to run: the workspace's, presets first and then its own by name (A57), or the four presets when the workspace
 * has none (the database seeds them, so this is the demo and old rows).
 */
export function stressConditions(rows: readonly MarketConditionRow[] | undefined): StressCondition[] {
  if (rows?.length) return orderConditions(rows).map((c) => ({ key: c.id, name: c.name, preset: c.preset, factors: factorsFromPercents(c) }));
  return (Object.keys(MARKET_PRESETS) as MarketPresetKey[]).map((k) => ({ key: k, name: MARKET_PRESETS[k].name, preset: k, factors: MARKET_PRESETS[k].factors as MarketFactors }));
}

/**
 * The targets to check under each market: every issue the solution solves that is still there, with the steps its verdict reads in
 * the solution's map (the same area the Editor and the server use).
 */
export function stressTargets(c: Pick<Comparison, "base" | "solved">, links: readonly SolutionIssueRow[], issues: readonly IssueRow[], processId: string): StressTarget[] {
  const was = new Set(c.base.steps.map((s) => s.id));
  const added = c.solved.steps.filter((s) => !was.has(s.id)).map((s) => s.id);
  const byId = new Map(issues.map((i) => [i.id, i]));
  return links.flatMap((l) => {
    const issue = byId.get(l.issue_id);
    if (!issue) return [];
    const asIssue = solutionIssueOf(issue, processId, c.solved.steps);
    return [{ issueId: issue.id, number: issue.number, title: issue.title, target: asIssue.target, area: verdictArea(c.solved.steps, asIssue, added) }];
  });
}

export const RESULT_WORDS: Record<StressResult, string> = { pass: "Pass", fail: "Fail", unchecked: "Not checked" };

/** One market's result: a pass only if every issue that could be checked passes, a fail if any fails, else not checked. */
export function overallResult(verdicts: readonly { status: StressResult }[]): StressResult {
  const checked = verdicts.filter((v) => v.status !== "unchecked");
  if (!checked.length) return "unchecked";
  return checked.every((v) => v.status === "pass") ? "pass" : "fail";
}

/** "Better", "Worse" or "About the same" for a row of the measures table (the engine's tone, or none for a row it does not rate). */
export const toneWord = (tone: "good" | "bad" | null): string => (tone === "good" ? "Better" : tone === "bad" ? "Worse" : "About the same");
