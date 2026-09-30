// The Northbeam report on /demo (no database): the seed fixtures, run in this
// function, with an in-memory robustness cache so a second report of the same
// model and scenarios reuses the checks.

import { northbeamIssues, northbeamScenarios } from "@transpera-flow/db";
import { MemoryRobustnessCache } from "@transpera-flow/engine";
import { demoBundle, demoSources } from "@/lib/sources/demo";
import { buildReportContent, type BuiltReport } from "./assemble";
import type { ReportSectionId } from "./content";
import { parseSections, REPORT_DEFAULT_REPS, REPORT_ROBUSTNESS_BUDGET_MS, REPORT_SHADOW_PRICE_BUDGET_MS } from "./options";

const cache = new MemoryRobustnessCache(50_000);

/** The scenarios the demo report compares unless others are chosen: the two fixes linked to issues. */
export const DEMO_DEFAULT_SCENARIOS = northbeamScenarios()
  .filter((s) => s.name === "Hire a strategist" || s.name === "Automate proposals")
  .map((s) => s.id);

export function demoScenarios() {
  return northbeamScenarios();
}

/**
 * What the demo form asked for. A bare link (no `sections`) gets every
 * section and the default scenarios; otherwise exactly what was ticked.
 */
export function demoRequest(params: URLSearchParams): { sections: ReportSectionId[]; scenarioIds: string[] } {
  if (!params.has("sections")) return { sections: parseSections(undefined), scenarioIds: DEMO_DEFAULT_SCENARIOS };
  const known = new Set(northbeamScenarios().map((s) => s.id));
  return { sections: parseSections(params.getAll("sections")), scenarioIds: [...new Set(params.getAll("scenarios"))].filter((id) => known.has(id)) };
}

export function buildDemoReport({
  sections,
  scenarioIds,
  reps = REPORT_DEFAULT_REPS,
  today = new Date().toISOString(),
}: {
  sections: ReportSectionId[];
  scenarioIds: string[];
  reps?: number;
  today?: string;
}): BuiltReport {
  return buildReportContent({
    bundle: demoBundle(),
    scenarios: northbeamScenarios(),
    issues: northbeamIssues(),
    sources: demoSources(),
    run: { id: null, name: "Demo run", seed: 1, reps, engineVersion: null, startDate: today.slice(0, 10), savedAt: null },
    options: { sections, scenarioIds },
    generatedAt: today,
    generatedBy: "Demo",
    robustness: { cache, timeBudgetMs: REPORT_ROBUSTNESS_BUDGET_MS },
    shadowPriceBudgetMs: REPORT_SHADOW_PRICE_BUDGET_MS,
  });
}
