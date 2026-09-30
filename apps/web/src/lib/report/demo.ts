// The Northbeam report on /demo (no database): the seed fixtures, run in this
// function, with an in-memory robustness cache so a second report of the same
// model and scenarios reuses the checks.

import { northbeamIssues, northbeamScenarios } from "@transpera-flow/db";
import { MemoryRobustnessCache } from "@transpera-flow/engine";
import { demoBundle, demoSources } from "@/lib/sources/demo";
import { buildReportContent, type BuiltReport } from "./assemble";
import { demoNarratedContent } from "@/lib/narration/demo";
import type { NumberProblem } from "@/lib/narration/numbers";
import type { ReportContent, ReportSectionId } from "./content";
import { esc } from "./html";
import { editSummary } from "./narration";
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

/**
 * The demo report as the form asked for it (#29): `narrate=1` narrates the
 * summary with the demo's stand-in writer (never the paid API: /demo is
 * public), and `summary` is a visitor's edit, checked against the report's
 * figures like any edit and recorded as "edited by Demo visitor".
 */
export async function demoReportContent(
  params: URLSearchParams,
  { today = new Date().toISOString(), reps }: { today?: string; reps?: number } = {},
): Promise<{ ok: true; content: ReportContent } | { ok: false; problems: NumberProblem[] }> {
  let { content } = buildDemoReport({ ...demoRequest(params), today, ...(reps ? { reps } : {}) });
  if (params.get("narrate") === "1") content = await demoNarratedContent(content, today);
  const edited = params.get("summary");
  if (edited?.trim() && content.summary) {
    const edit = editSummary(content, [edited], "Demo visitor", today);
    if (!edit.ok) return { ok: false, problems: edit.problems };
    content = edit.content;
  }
  return { ok: true, content };
}

/** Why an edited demo summary can't print (422). */
export function demoProblemsPage(problems: NumberProblem[]): Response {
  const items = problems.map((p) => `<li><code>${esc(p.text)}</code>: ${esc(p.reason)}</li>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>Summary not printed</title><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>The edited summary can't print</h1><p>These figures aren't in the report as written:</p><ul>${items}</ul><p><a href="/demo/report">Back to the report builder</a></p></body>`;
  return new Response(html, { status: 422, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
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
