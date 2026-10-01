import { beforeAll, describe, expect, it } from "vitest";
import { northbeamIssues, northbeamScenarios, northbeamStepIds, runResults, toEngineModel, type ProcessBundle, type ScenarioRow } from "@transpera-flow/db";
import { ENGINE_VERSION, MemoryRobustnessCache, simulate } from "@transpera-flow/engine";
import { compareScenarios } from "@transpera-flow/mcp";
import { buildReportContent, describePatches, normaliseSections, type ReportInput } from "@/lib/report/assemble";
import { SECTION_IDS, type ReportContent } from "@/lib/report/content";
import { formatFigure } from "@/lib/report/format";
import { parseReportRequest, parseSections } from "@/lib/report/options";
import { renderReportHtml } from "@/lib/report/render";
import { robustnessCheckKey } from "@/lib/report/robustness-cache";
import { fromByteaHex, linkHash, newLinkToken, reportLinks, sameResults, toByteaHex } from "@/lib/report/server";
import { reportFacts } from "@/lib/report/summary";
import { processMapSvg } from "@/lib/report/svg";
import { demoBundle, demoSources } from "@/lib/sources/demo";

// The PDF report's content (issue #28): assembled from the live model and one
// run by pure functions, so every number can be checked against the run, and
// rendered to the one HTML document both the server PDF and the browser's
// "Save as PDF" print.

const REPS = 20;
const SEED = 1;
const START = "2026-09-30";
const scenarios = northbeamScenarios();
const hire = scenarios.find((s) => s.name === "Hire a strategist")!;
const automate = scenarios.find((s) => s.name === "Automate proposals")!;

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    bundle: demoBundle(),
    scenarios,
    issues: northbeamIssues(),
    sources: demoSources(),
    run: { id: "5a000000-0000-4000-8000-0000000000c1", name: "Report run", seed: SEED, reps: REPS, engineVersion: "test-engine", startDate: START, savedAt: `${START}T09:00:00.000Z` },
    options: { sections: [...SECTION_IDS], scenarioIds: [hire.id, automate.id] },
    generatedAt: `${START}T10:00:00.000Z`,
    generatedBy: "austin@example.com",
    robustness: { timeBudgetMs: 120_000 },
    shadowPriceBudgetMs: 60_000,
    ...overrides,
  };
}

let full: ReturnType<typeof buildReportContent>;
let cache: MemoryRobustnessCache;
beforeAll(() => {
  cache = new MemoryRobustnessCache();
  full = buildReportContent(input({ robustness: { cache, timeBudgetMs: 120_000 } }));
}, 120_000);

describe("report content", () => {
  it("takes every number from the run: seeded, replicated and ranged exactly as the engine gave them", () => {
    const model = toEngineModel(demoBundle(), { startDate: START });
    const run = simulate(model, REPS, SEED);
    const { content } = full;
    const kpi = (key: string) => content.kpis.find((k) => k.key === key)!;
    expect(kpi("won").stat).toEqual(run.kpi.won);
    expect(kpi("lost").stat).toEqual(run.kpi.lost);
    expect(kpi("mrrAdded").stat).toEqual(run.kpi.mrrAdded);
    expect(kpi("billed").stat).toEqual(run.kpi.billed);
    expect(kpi("clientsAtRisk").stat).toEqual(run.kpi.clientsAtRisk);
    expect(kpi("cycle").stat).toEqual({ mean: run.kpi.cycle.mean, p10: run.kpi.cycle.p50, p90: run.kpi.cycle.p90 });
    expect(kpi("bottleneck").stat).toEqual(run.kpi.roles[run.bnRole!]!.util);
    // What a saved run keeps is exactly what the report shows.
    expect(runResults(full.model, full.baseline, "GBP")).toEqual(runResults(model, run, "GBP"));
    expect(content.run).toMatchObject({ seed: SEED, reps: REPS, engineVersion: "test-engine", startDate: START, id: "5a000000-0000-4000-8000-0000000000c1" });
    // Clients and utilisation are the run's per-client and per-role figures.
    for (const c of content.clients!.clients) expect(c.health).toEqual(run.clients![c.id]!.health);
    for (const r of content.utilisation!.roles) expect(r.util).toEqual(run.kpi.roles[r.id]!.util);
    // Scenario tables are the compare view's (and MCP compare_scenarios') for the same run settings.
    const cmp = compareScenarios({ model, a: [], b: [hire], reps: REPS, seed: SEED, currency: "GBP" });
    const view = content.scenarios!.find((s) => s.id === hire.id)!;
    expect(view.headline).toBe(cmp.headline);
    expect(view.table.map((r) => [r.label, r.baseline, r.scenario, r.change, r.changeRange])).toEqual(cmp.table.map((r) => [r.label, r.baseline, r.scenario, r.change, r.changeRange]));
  });

  it("shows every headline figure with its range", () => {
    for (const k of full.content.kpis) {
      expect(k.stat.p10, k.key).toBeLessThanOrEqual(k.stat.p90);
      if (k.range !== "p50_p90") {
        expect(k.stat.mean, k.key).toBeGreaterThanOrEqual(k.stat.p10 - 1e-9);
        expect(k.stat.mean, k.key).toBeLessThanOrEqual(k.stat.p90 + 1e-9);
      }
    }
    const summary = full.content.summary!.paragraphs.join(" ");
    const won = full.content.kpis.find((k) => k.key === "won")!;
    const ctx = { currency: "GBP", hoursPerWeek: 40 };
    expect(summary).toContain(`wins avg ${formatFigure("count", won.stat.mean, ctx)} (range `);
    expect(summary).toContain(full.content.scenarios![0]!.headline);
    expect(full.content.summary!.source).toBe("template");
  });

  it("includes every section, in print order, when all are asked for and the data is there", () => {
    expect(full.content.included).toEqual([...SECTION_IDS]);
    expect(full.content.omitted).toEqual([]);
    const html = renderReportHtml(full.content);
    const order = [...html.matchAll(/data-section="([a-z_]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...SECTION_IDS]);
  });

  it("leaves out sections that weren't asked for, keeping the cover and the print order", () => {
    const { content } = buildReportContent(input({ options: { sections: ["methodology", "summary", "issues"], scenarioIds: [] } }));
    expect(content.included).toEqual(["cover", "summary", "issues", "methodology"]);
    expect(content.processMaps).toBeNull();
    expect(content.utilisation).toBeNull();
    expect(content.appendix).toBeNull();
    expect(normaliseSections(["robustness", "bogus", "cover"])).toEqual(["cover", "robustness"]);
  });

  it("omits client health without a roster, and scenarios and robustness without a runnable scenario, saying why", () => {
    const bundle: ProcessBundle = { ...demoBundle(), clients: [], clientServices: [], clientAssignments: [] };
    const broken: ScenarioRow = { ...hire, id: "5a000000-0000-4000-8000-0000000000d1", name: "Speed up a deleted step", patch: [{ path: "steps.gone.work_hours", op: "multiply", value: 0.5 }] };
    const { content } = buildReportContent(input({ bundle, scenarios: [...scenarios, broken], options: { sections: [...SECTION_IDS], scenarioIds: [broken.id] } }));
    expect(content.included).not.toContain("clients");
    expect(content.included).not.toContain("scenarios");
    expect(content.included).not.toContain("robustness");
    expect(content.omitted.map((o) => o.section)).toEqual(["clients", "scenarios", "robustness"]);
    expect(content.omitted[0]!.reason).toMatch(/no client roster/);
    expect(content.omitted[1]!.reason).toMatch(/need attention/);
    expect(content.excludedScenarios).toEqual([{ id: broken.id, name: broken.name, reason: expect.stringMatching(/^It needs attention: /) }]);
    // A broken scenario is also an issue in the register (docs/PRD.md D10).
    expect(content.issues!.groups.flatMap((g) => g.issues).some((i) => i.type === "broken_scenario")).toBe(true);
    // No scenarios chosen at all.
    const none = buildReportContent(input({ options: { sections: ["scenarios", "robustness"], scenarioIds: [] } })).content;
    expect(none.omitted.map((o) => o.reason)).toEqual(["No scenarios were chosen.", "No scenarios were chosen."]);
    expect(none.scenarios).toBeNull();
  });

  it("groups issues by rating with their owner and linked fix", () => {
    const { groups } = full.content.issues!;
    const order = ["risk", "bad", "good", "great"];
    expect(groups.map((g) => order.indexOf(g.rating))).toEqual([...groups.map((g) => order.indexOf(g.rating))].sort((a, b) => a - b));
    const all = groups.flatMap((g) => g.issues);
    const manual = all.find((i) => i.title === "Every proposal is built by hand")!;
    expect(manual).toMatchObject({ rating: "bad", owner: "Rosa Diaz", status: "Open", fix: { name: "Automate proposals", inReport: true } });
    const spof = all.find((i) => i.title.startsWith("Only Maya Collins can do Audit"))!;
    expect(spof).toMatchObject({ source: "promoted", owner: "Rosa Diaz", status: "In progress", fix: { name: "Hire a strategist", inReport: true } });
    // Detections nobody tracks yet are listed as detected, unowned.
    expect(all.some((i) => i.status === "Detected" && i.owner === null)).toBe(true);
    // A tracked detection shows once.
    expect(all.filter((i) => i.title === spof.title)).toHaveLength(1);
  });

  it("runs robustness for every included scenario, and reuses cached checks", () => {
    for (const s of full.content.scenarios!) {
      expect(s.robustness!.verdict).toMatch(/of cases/);
      expect(s.robustness!.complete).toBe(true);
      expect(s.robustness!.jobs).toBeGreaterThan(0);
    }
    const again = buildReportContent(input({ robustness: { cache, timeBudgetMs: 120_000 } })).content;
    for (const s of again.scenarios!) expect(s.robustness!.cached).toBe(s.robustness!.jobs);
    // The same verdicts either way.
    expect(again.scenarios!.map((s) => s.robustness!.verdict)).toEqual(full.content.scenarios!.map((s) => s.robustness!.verdict));
    // The database cache's check key is the engine's job-key prefix.
    const model = toEngineModel(demoBundle(), { startDate: START });
    const key = robustnessCheckKey(model, hire.patch);
    expect([...cacheKeys(cache)].some((k) => k.startsWith(`${key}|`))).toBe(true);
  }, 120_000);

  it("says in the verdict when the time cap stopped a check early", () => {
    let t = 0;
    const { content } = buildReportContent(
      input({ options: { sections: ["scenarios", "robustness"], scenarioIds: [hire.id] }, robustness: { timeBudgetMs: 5, now: () => (t += 10) } }),
    );
    const r = content.scenarios![0]!.robustness!;
    expect(r.complete).toBe(false);
    expect(r.details.join(" ")).toMatch(/Stopped early/);
  });

  it("is the same content for the same input", () => {
    const opts = { options: { sections: [...SECTION_IDS], scenarioIds: [] } };
    expect(JSON.stringify(buildReportContent(input(opts)).content)).toBe(JSON.stringify(buildReportContent(input(opts)).content));
  });

  it("draws each process map from its saved layout, with numbered bottleneck callouts in print order", () => {
    const maps = full.content.processMaps!;
    const bundle = demoBundle();
    expect(maps.map((m) => m.name)).toEqual([bundle.process.name, ...(bundle.otherProcesses ?? []).map((p) => p.process.name)]);
    const pipeline = maps[0]!;
    expect(pipeline.nodes.map((n) => [n.id, n.x, n.y])).toEqual(bundle.steps.map((s) => [s.id, s.x, s.y]));
    const numbers = maps.flatMap((m) => m.callouts.map((c) => c.n));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    const svg = processMapSvg(pipeline);
    expect((svg.match(/<g>/g) ?? []).length).toBe(pipeline.nodes.length);
    expect(svg).toContain("Audit &amp; proposal");
    // The conflict on audit time and the assumption on kickoff time show as badges.
    expect(pipeline.nodes.find((n) => n.id === northbeamStepIds.audit)!.conflict).toBe(true);
    expect(svg).toContain(">Conflict<");
    expect(svg).toContain(">Assumption<");
  });

  it("lists assumptions, evidence, conflicts and sources in the appendix, and who produced what", () => {
    const a = full.content.appendix!;
    expect(a.conflicts.some((c) => c.parameter === "hands-on time" && /Maya Collins/.test(c.values))).toBe(true);
    expect(a.assumptions.some((x) => x.status === "assumption" && /Kickoff/.test(x.where))).toBe(true);
    expect(a.evidence.length).toBeGreaterThan(0);
    expect(a.sources.map((s) => s.title).sort()).toEqual(demoSources().map((s) => s.title).sort());
    expect(a.provenance.join(" ")).toMatch(/engine test-engine, 20 replications from seed 1/);
    expect(a.provenance.join(" ")).toMatch(/templated text .* no language model/);
  });

  it("prints the engine version of the run on the methodology page: the saved run's, or the engine that ran it", () => {
    expect(full.content.methodology!.paragraphs.join(" ")).toContain("with engine test-engine");
    const fresh = buildReportContent(input({ run: { ...input().run, engineVersion: null }, options: { sections: ["methodology"], scenarioIds: [] } })).content;
    expect(fresh.run.engineVersion).toBe(ENGINE_VERSION);
    expect(fresh.methodology!.paragraphs.join(" ")).toContain(`with engine ${ENGINE_VERSION}`);
  });

  it("lists every stated number for narration (#29) to check against", () => {
    const facts = reportFacts(full.content);
    const won = full.content.kpis.find((k) => k.key === "won")!.stat;
    expect(facts["kpi.won.mean"]).toBe(won.mean);
    expect(facts["kpi.won.p90"]).toBe(won.p90);
    expect(facts["shadowPrice.perQuarter.mean"]).toBe(full.content.bottlenecks!.shadowPrice!.perQuarter.mean);
  });

  it("describes scenario patches in words", () => {
    expect(describePatches(full.model, automate.patch)).toEqual(["Audit & proposal: hands-on time × 0.4"]);
  });
});

describe("report HTML", () => {
  it("escapes what people typed", () => {
    const c: ReportContent = { ...full.content, workspace: { ...full.content.workspace, name: '<script>alert("x")</script>' }, title: "A & B" };
    const html = renderReportHtml(c);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // The footer text sits in CSS inside <style>: no way out of it either.
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it("keeps tables and charts whole across pages and numbers the pages", () => {
    const html = renderReportHtml(full.content);
    expect(html).toMatch(/table\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/figure\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/tr\{break-inside:avoid/);
    expect(html).toContain('counter(page) " of " counter(pages)');
  });

  it("adds the screen toolbar only when asked, and never prints it", () => {
    expect(renderReportHtml(full.content)).not.toContain('class="toolbar"');
    const html = renderReportHtml(full.content, { toolbar: { pdfUrl: "/api/reports/x/pdf", backUrl: "/w/n/reports" } });
    expect(html).toContain('class="toolbar"');
    expect(html).toContain("window.print()");
    expect(html).toMatch(/@media print\{[^]*\.toolbar\{display:none\}/);
  });
});

describe("report requests and links", () => {
  it("checks what the builder sends", () => {
    const processId = "5a000000-0000-4000-8000-000000000001";
    expect(parseReportRequest({ processId })).toEqual({ ok: true, value: { processId, runId: null, reps: 200, sections: [...SECTION_IDS], scenarioIds: [], narrate: false } });
    expect(parseReportRequest({ processId, narrate: true })).toMatchObject({ ok: true, value: { narrate: true } });
    expect(parseReportRequest({ processId, reps: 0 }).ok).toBe(false);
    expect(parseReportRequest({ processId, scenarioIds: ["nope"] }).ok).toBe(false);
    expect(parseReportRequest({ processId: "x" }).ok).toBe(false);
    expect(parseSections("summary,bogus")).toEqual(["cover", "summary"]);
    expect(parseSections(undefined)).toEqual([...SECTION_IDS]);
  });

  it("makes 256-bit link tokens and keeps only their hash", () => {
    const { token, hash } = newLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(linkHash(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reportLinks("https://app.test/", "r1", token)).toEqual({
      url: `https://app.test/api/reports/r1/pdf?token=${token}`,
      jsonUrl: `https://app.test/api/reports/r1/pdf?token=${token}&format=json`,
    });
  });

  it("round-trips PDF bytes through Postgres bytea hex", () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
    expect(toByteaHex(bytes)).toBe("\\x255044460" + "0ff");
    expect(fromByteaHex(toByteaHex(bytes))).toEqual(bytes);
    expect(fromByteaHex(null)).toBeNull();
  });

  it("accepts a saved run only if re-running it gives the numbers it saved", () => {
    const saved = runResults(full.model, full.baseline, "GBP");
    expect(sameResults(saved, structuredClone(saved))).toBe(true);
    expect(sameResults(saved, { ...saved, won: { ...saved.won, mean: saved.won.mean + 0.1 } })).toBe(false);
  });
});

function cacheKeys(c: MemoryRobustnessCache): string[] {
  return [...(c as unknown as { map: Map<string, unknown> }).map.keys()];
}
