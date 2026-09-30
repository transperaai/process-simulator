import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { northbeamScenarios } from "@transpera-flow/db";
import { withSummary } from "@/lib/report/assemble";
import { SECTION_IDS, type ReportContent } from "@/lib/report/content";
import { buildDemoReport, demoReportContent } from "@/lib/report/demo";
import { editSummary } from "@/lib/report/narration";
import { renderReportHtml } from "@/lib/report/render";
import { editCheck, redact, reportNarrationInput, restoreNames, runNarrationInput } from "@/lib/narration/facts";
import { demoNarratedContent, demoNarrator } from "@/lib/narration/demo";
import { checkText, narrate, NarrationError, type DraftRequest, type NarrationModel } from "@/lib/narration/narrate";
import { summaryFromNarration } from "@/lib/narration/service";

vi.mock("server-only", () => ({}));

// Narration (issue #29; docs/PRD.md §7.3, D15): drafts checked number by
// number, one redraft naming the failures, the template as the fallback with
// the reason, names kept from the model, and the printed report saying which
// summary it is and who edited it. Every model here is a deterministic fake:
// tests never call the Anthropic API.

const START = "2026-09-30";
let content: ReportContent;

beforeAll(() => {
  const scenarioIds = northbeamScenarios()
    .filter((s) => s.name === "Hire a strategist")
    .map((s) => s.id);
  content = buildDemoReport({ sections: [...SECTION_IDS], scenarioIds, reps: 20, today: `${START}T10:00:00.000Z` }).content;
}, 120_000);

/** A fake model: returns the scripted drafts in turn (a function of the request), recording each request. */
function fake(...drafts: ((req: DraftRequest) => string[] | Error)[]): NarrationModel & { calls: DraftRequest[] } {
  const calls: DraftRequest[] = [];
  return {
    name: "fake-model",
    calls,
    async draft(req) {
      calls.push(req);
      const next = drafts[Math.min(calls.length - 1, drafts.length - 1)]!(req);
      if (next instanceof Error) throw next;
      return { paragraphs: next, model: "fake-model", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: calls.length > 1 ? 90 : 0 } };
    },
  };
}

const factsOf = (req: DraftRequest) => JSON.parse(req.facts.slice(req.facts.indexOf("{"))) as Record<string, unknown>;
const templateFrom = (req: DraftRequest) => factsOf(req).templatedSummary as string[];

describe("what the model is sent", () => {
  it("keeps names out: clients and people become labels; no workspace name, evidence or appendix", () => {
    const input = reportNarrationInput(content);
    const sent = JSON.stringify(input.payload);
    for (const name of [...content.names!.clients, ...content.names!.people]) expect(sent, name).not.toContain(name);
    expect(sent).not.toContain(content.workspace.name);
    for (const e of content.appendix!.evidence.slice(0, 5)) expect(sent).not.toContain(e.quote);
    expect(sent).toMatch(/Client [A-Z]/);
    // The robustness verdict and the average-plus-range form are in the facts the prompt requires.
    expect(sent).toContain(content.scenarios![0]!.robustness!.verdict);
    expect(sent).toMatch(/avg £[\d.]+k \(range £[\d.]+k–£[\d.]+k\)/);
  });

  it("the templated text passes its own check, so the fallback is always printable", () => {
    const input = reportNarrationInput(content);
    expect(checkText(input.payload.templatedSummary as string[], input.check).problems).toEqual([]);
    expect(checkText(input.template, editCheck(input)).problems).toEqual([]);
    const run = runNarrationInput(
      { id: "r", name: "Audit baseline", created_at: `${START}T09:00:00Z`, results: { horizon_weeks: 13, hours_per_week: 40, currency: "GBP", reps: 30, won: { mean: 8.6, p10: 6, p90: 12 }, lost: { mean: 78.25, p10: 70, p90: 91 }, cycle: { mean: 225, p50: 220, p90: 304 }, mrr_added: { mean: 33005, p10: 22400, p90: 45500 }, billed: { mean: 349352.6, p10: 333536, p90: 371455 }, overtime_hours: { mean: 0, p10: 0, p90: 0 }, bottleneck: { role: "Strategist", util: { mean: 0.965, p10: 0.867, p90: 1.013 } } } },
      "Lead to live",
    );
    expect(checkText(run.template, run.check).problems).toEqual([]);
  });

  it("the cache key follows the facts: same report, same hash; other scenarios, another", () => {
    const a = reportNarrationInput(content);
    expect(reportNarrationInput({ ...content, generatedAt: "2030-01-01T00:00:00Z" }).hash).toBe(a.hash);
    expect(reportNarrationInput({ ...content, summary: { ...content.summary!, paragraphs: ["edited"] } }).hash).toBe(a.hash);
    expect(reportNarrationInput({ ...content, scenarios: null }).hash).not.toBe(a.hash);
  });

  it("maps labels back to names without touching other words", () => {
    const aliases = [
      { name: "Sam", label: "Team member A" },
      { name: "Northgate Motors", label: "Client B" },
    ];
    expect(redact("Sam and Samantha at Northgate Motors", aliases)).toBe("Team member A and Samantha at Client B");
    expect(restoreNames("Team member A helps Client B; Client BC is another.", aliases)).toBe("Sam helps Northgate Motors; Client BC is another.");
  });
});

describe("drafting and checking (fake models)", () => {
  it("accepts a draft whose every figure is in the facts", async () => {
    const model = fake((req) => templateFrom(req));
    const input = reportNarrationInput(content);
    const out = await narrate(input, model);
    expect(out).toMatchObject({ source: "narration", validated: true, fallback: false, reason: null, model: "fake-model", rejected: [] });
    expect(out.checked).toBeGreaterThan(10);
    // Names are restored in the text that prints.
    expect(out.paragraphs.join(" ")).toContain(content.clients!.clients[0]!.name);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.system).toMatch(/average with its range/);
    expect(model.calls[0]!.system).toMatch(/robustness verdict/);
  });

  it("rejects an invented figure, redrafts once naming it, and accepts the redraft", async () => {
    const model = fake(
      (req) => [...templateFrom(req), "Hiring saves £50k a year and doubles wins."],
      (req) => templateFrom(req),
    );
    const out = await narrate(reportNarrationInput(content), model);
    expect(out.source).toBe("narration");
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]!.problems.map((p) => p.text)).toEqual(["doubles", "£50k"]);
    expect(model.calls[1]!.instruction).toContain("“£50k”");
    expect(model.calls[1]!.instruction).toContain("“doubles”");
    // The redraft reuses the same facts block (the cached prefix).
    expect(model.calls[1]!.facts).toBe(model.calls[0]!.facts);
    expect(out.usage).toHaveLength(2);
  });

  it("falls back to the template after two failed drafts, saying which figures failed", async () => {
    const model = fake(() => ["Wins rise to 14.2 a quarter."]);
    const input = reportNarrationInput(content);
    const out = await narrate(input, model);
    expect(out).toMatchObject({ source: "template", validated: false, fallback: true, fallbackKind: "invalid", paragraphs: input.template });
    expect(out.reason).toContain("“14.2”");
    expect(out.rejected).toHaveLength(2);
    expect(model.calls).toHaveLength(2);
  });

  it("falls back on refusals, timeouts, API errors, bad shapes and a missing key", async () => {
    const input = reportNarrationInput(content);
    expect((await narrate(input, fake(() => new NarrationError("refused", "declined")))).fallbackKind).toBe("refused");
    expect((await narrate(input, fake(() => new NarrationError("timeout", "timed out")))).reason).toBe("the model didn't answer in time");
    const err = await narrate(input, fake(() => new Error("socket hang up")));
    expect(err).toMatchObject({ fallbackKind: "error", source: "template" });
    expect(err.reason).toContain("socket hang up");
    expect((await narrate(input, fake(() => []))).fallbackKind).toBe("invalid");
    expect((await narrate(input, fake(() => Array.from({ length: 12 }, () => "Wins avg 8.6.")))).rejected[0]!.problems[0]!.reason).toMatch(/more than 8/);
    const none = await narrate(input, null);
    expect(none).toMatchObject({ fallbackKind: "unavailable", source: "template" });
    expect(none.reason).toMatch(/API key/);
  });

  it("stays within the time budget: no redraft when the first draft used it up", async () => {
    let t = 0;
    const model = fake((req) => {
      t += 72_000;
      return [...templateFrom(req), "It saves £50k."];
    });
    const out = await narrate(reportNarrationInput(content), model, { now: () => t });
    expect(out).toMatchObject({ fallbackKind: "timeout", source: "template" });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.timeoutMs).toBe(45_000);
  });
});

describe("the printed report", () => {
  it("prints a narrated summary and says so in the appendix and methodology", async () => {
    const out = await narrate(reportNarrationInput(content), fake((req) => templateFrom(req)));
    const narrated = withSummary(content, summaryFromNarration({ ...out, id: "n1", cached: false, at: `${START}T10:05:00Z`, editedBy: null, editedAt: null }));
    const html = renderReportHtml(narrated);
    expect(narrated.summary!.source).toBe("narration");
    expect(narrated.appendix!.provenance.at(-1)).toMatch(/^Executive summary: drafted by fake-model on 30 Sept 2026 from this report's figures; all \d+ numbers in it matched/);
    expect(narrated.methodology!.paragraphs.at(-1)).toMatch(/drafted by fake-model from this report/);
    const byClaude = withSummary(content, { ...narrated.summary!, narration: { ...narrated.summary!.narration!, model: "claude-opus-5-5" } });
    expect(byClaude.methodology!.paragraphs.at(-1)).toMatch(/drafted by a language model \(Claude, claude-opus-5-5\)/);
    expect(html).toContain("drafted by fake-model");
    expect(html).toContain("<p class=\"small muted\" data-summary-note>Drafted by fake-model from this report's figures; every number in it was checked against them.</p>");
    // The template's report says the opposite.
    expect(content.appendix!.provenance.at(-1)).toBe("Executive summary: templated text filled in from the run; no language model.");
    expect(content.methodology!.paragraphs.at(-1)).toMatch(/no language model wrote any of it/);
  });

  it("prints the template with the reason when narration fell back", async () => {
    const out = await narrate(reportNarrationInput(content), fake(() => ["Wins rise to 14.2."]));
    const fell = withSummary(content, summaryFromNarration({ ...out, id: null, cached: false, at: `${START}T10:05:00Z`, editedBy: null, editedAt: null }));
    expect(fell.summary!.source).toBe("template");
    expect(fell.summary!.paragraphs).toEqual(content.summary!.paragraphs);
    expect(fell.appendix!.provenance.at(-1)).toMatch(/A narrated summary was asked for but not used: both drafts cited figures not in the report: “14.2”/);
  });

  it("an edit is checked and recorded as edited by its author; an invented figure is refused", () => {
    const edited = editSummary(content, [`${content.summary!.paragraphs[0]}\n\nIn short: fix the Strategist bottleneck first.`], "austin@transpera.ai", `${START}T11:00:00Z`);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.content.summary).toMatchObject({ editedBy: "austin@transpera.ai", editedAt: `${START}T11:00:00Z` });
    expect(edited.content.summary!.paragraphs).toHaveLength(2);
    expect(edited.content.appendix!.provenance.at(-1)).toMatch(/Edited by austin@transpera\.ai on 30 Sept 2026; the edit was checked the same way\./);
    expect(renderReportHtml(edited.content)).toContain("Edited by austin@transpera.ai");

    const bad = editSummary(content, ["Hiring adds £12k of MRR by 14 November 2026."], "austin@transpera.ai", `${START}T11:00:00Z`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((p) => p.text).sort()).toEqual(["14 November 2026", "£12k"]);
    // Real names are fine in an edit (the model only ever sees labels).
    expect(editSummary(content, [`${content.clients!.clients[0]!.name} is most at risk.`], "a", START).ok).toBe(true);
  });
});

describe("the demo", () => {
  it("narrates with the stand-in (never the API), checked like Claude", async () => {
    const narrated = await demoNarratedContent(content, `${START}T10:00:00Z`);
    expect(narrated.summary).toMatchObject({ source: "narration", editedBy: null });
    expect(narrated.summary!.narration!.model).toBe(demoNarrator.name);
    expect(narrated.summary!.paragraphs.join(" ")).toContain("How far to trust it");
  });

  it("prints a visitor's edit, or refuses it with the figures that failed", async () => {
    const params = new URLSearchParams([
      ["sections", "summary"],
      ["narrate", "1"],
    ]);
    const plain = await demoReportContent(params, `${START}T10:00:00.000Z`);
    if (!plain.ok) throw new Error("expected the demo report");
    const first = plain.content.summary!.paragraphs[0]!;
    params.set("summary", `${first}\n\nOur take: start with the bottleneck.`);
    const ok = await demoReportContent(params, `${START}T10:00:00.000Z`);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.content.summary).toMatchObject({ source: "narration", editedBy: "Demo visitor", paragraphs: [first, "Our take: start with the bottleneck."] });
    params.set("summary", "Wins avg 9.9.");
    const bad = await demoReportContent(params, `${START}T10:00:00.000Z`);
    expect(bad.ok).toBe(false);
  }, 120_000);
});

describe("the API key stays on the server", () => {
  const src = join(__dirname, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

  it("only server code reads ANTHROPIC_API_KEY or imports the SDK, and the client module is server-only", () => {
    const all = files(src).filter((f) => /\.tsx?$/.test(f));
    const readers = all.filter((f) => /process\.env\.ANTHROPIC_API_KEY|@anthropic-ai\/sdk/.test(readFileSync(f, "utf8")));
    expect(readers.map((f) => f.slice(src.length))).toEqual(["/lib/narration/anthropic.ts"]);
    expect(readFileSync(join(src, "lib/narration/anthropic.ts"), "utf8")).toMatch(/^import "server-only";/);
    const clientFiles = all.filter((f) => /^["']use client["']/.test(readFileSync(f, "utf8")));
    for (const f of clientFiles) expect(readFileSync(f, "utf8"), f).not.toMatch(/narration\/(anthropic|service|explain)/);
  });
});
