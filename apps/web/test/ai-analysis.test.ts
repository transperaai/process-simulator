import { describe, expect, it, vi } from "vitest";
import { toEngineModel } from "@transpera-flow/db";
import { simulate, type DetectedIssue } from "@transpera-flow/engine";
import { analyseWithAi, quotationProblems, screenOutput, type AiDraftRequest, type AiModel } from "@/lib/ai/analyse";
import { aiInputForRun, quotesFromBundle } from "@/lib/ai/input";
import { aiDetections, aiViewFromRow, readInsights } from "@/lib/ai/types";
import { demoFirstPrinciples } from "@/lib/first-principles/demo-seed";
import { buildInsights } from "@/lib/insights/insights";
import { registerEntries } from "@/lib/issues/register";
import { MemoryIssueStore } from "@/lib/issues/store";
import { parsePromoteInput } from "@/lib/issues/validate";
import { acknowledgeInsight, dismissInsight } from "@/lib/insights/actions";
import { NarrationError } from "@/lib/narration/narrate";
import { demoBundle } from "@/lib/sources/demo";
import { northbeamStepIds } from "@transpera-flow/db";

vi.mock("server-only", () => ({}));

// AI analysis (issue #111, A46): drafts checked number by number, items with an unmatched number dropped, one redraft
// naming what failed, a clear failure when nothing is left. Every model here is a deterministic fake: tests never
// call the Anthropic API (a fetch that would is made to fail).

const bundle = demoBundle();
const model = toEngineModel(bundle);
const result = simulate(model, 10, 1);
const fp = demoFirstPrinciples();
const run = { bundle, model, result, firstPrinciples: fp };
const built = aiInputForRun({ ...run, quotes: [{ step: "Audit & proposal", quote: "Most weeks that's my Sunday, honestly" }] })!;
const { input, findings } = built;
const results = input.payload.results as Record<string, string>;
const first = findings[0]!;
const firstSentence = (s: string) => s.slice(0, s.search(/[.!?](\s|$)/) + 1);
const AUDIT = northbeamStepIds.audit;

/** What a good analysis looks like: every figure copied from the facts. */
const good = (): { read: string[]; insights: { title: string; type: string; rating: string; stepId: string | null; evidence: string; why: string }[]; review: { step: string; level: string; text: string }[] } => ({
  read: [`Over the run Northbeam wins ${results.wins}. ${firstSentence(first.evidence)}`],
  insights: [
    { title: "The audit step holds up the whole line", type: "bottleneck", rating: "bad", stepId: AUDIT, evidence: firstSentence(first.evidence), why: "Everything after it waits, and the first principles say proposals should go out quickly." },
  ],
  review: [{ step: "saa", level: "bad", text: "Automating the lead qualifier comes before you have decided to delete that step." }],
});

/** A fake model: returns the scripted drafts in turn (a function of the request), recording each request. */
function fake(...drafts: ((req: AiDraftRequest) => unknown | Error)[]): AiModel & { calls: AiDraftRequest[] } {
  const calls: AiDraftRequest[] = [];
  return {
    name: "fake-model",
    calls,
    async draft(req) {
      calls.push(req);
      const next = drafts[Math.min(calls.length - 1, drafts.length - 1)]!(req);
      if (next instanceof Error) throw next;
      return { output: next, model: "fake-model", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } };
    },
  };
}

describe("what the model is given", () => {
  it("holds the results, the rule findings, the first principles and the first-principles checks", () => {
    const p = input.payload as Record<string, unknown>;
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["run", "results", "findings", "firstPrinciples", "firstPrinciplesChecks", "successMeasures", "steps", "market"]));
    expect(findings.length).toBeGreaterThan(0);
    // Automation of a step that is still a delete candidate is caught by the rule check, and handed to the model.
    expect(JSON.stringify(p.firstPrinciplesChecks)).toContain("still a delete candidate");
  });

  it("never sends the workspace's name or a person's real name, and says nothing of sources unless asked", () => {
    const text = JSON.stringify(input.payload);
    expect(text).not.toContain(bundle.workspace.name);
    for (const person of bundle.people) expect(text, person.name).not.toContain(person.name);
    expect(text).toContain("Team member A");
    const without = aiInputForRun(run)!.input.payload;
    expect(without).not.toHaveProperty("quotesFromSources");
    expect(input.payload).toHaveProperty("quotesFromSources");
  });

  it("has nothing to analyse without first principles", () => {
    expect(aiInputForRun({ ...run, firstPrinciples: null })).toBeNull();
  });

  it("has the same hash for the same run and a different one when the run or the answers change", () => {
    expect(aiInputForRun(run)!.input.hash).toBe(aiInputForRun(run)!.input.hash);
    expect(aiInputForRun({ ...run, result: simulate(model, 10, 2) })!.input.hash).not.toBe(aiInputForRun(run)!.input.hash);
    expect(aiInputForRun({ ...run, firstPrinciples: { ...fp, why: { ...fp.why, root: "Something else" } } })!.input.hash).not.toBe(aiInputForRun(run)!.input.hash);
  });

  it("reads quotes from the cited evidence on the steps", () => {
    expect(quotesFromBundle(bundle).some((q) => q.quote.includes("twelve hours"))).toBe(true);
  });

  it("does not turn the team's own figures into facts: a number copied from the first principles is refused", () => {
    // "12%" is in the success measures (met-today is an engine figure), but "37.5 hours" is only in a truth the team wrote.
    const out = screenOutput({ read: ["The strategist has 37.5 hours a week."], insights: [], review: [] }, input);
    expect(out.readFailed).toBe(true);
    expect(out.rejected[0]!.problems[0]!.text).toContain("37.5");
  });
});

describe("analyseWithAi", () => {
  it("keeps a draft whose figures are all the run's, with the numbers it matched", async () => {
    const m = fake(() => good());
    const out = await analyseWithAi(input, m);
    expect(out).toMatchObject({ status: "ok", reason: null, dropped: 0, model: "fake-model" });
    expect(out.summary).toHaveLength(1);
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]).toMatchObject({ type: "bottleneck", rating: "bad", stepId: AUDIT });
    expect(out.insights[0]!.key).toMatch(/^ai:insight:[0-9a-f]{12}$/);
    expect(out.review).toHaveLength(1);
    expect(out.checked).toBeGreaterThan(0);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.facts).toContain("Facts (JSON)");
  });

  it("drops an insight that cites an invented figure and keeps the rest, then redrafts once naming it", async () => {
    const bad = good();
    bad.insights.push({ title: "Proposals lose £99,999 a month", type: "delay", rating: "risk", stepId: AUDIT, evidence: "Proposals lose £99,999 a month in the queue.", why: "Money." });
    const m = fake(
      () => bad,
      (req) => {
        expect(req.instruction).toContain("£99,999");
        expect(req.instruction).toContain("the insight “Proposals lose £99,999 a month”");
        return good();
      },
    );
    const out = await analyseWithAi(input, m);
    expect(m.calls).toHaveLength(2);
    expect(out.status).toBe("ok");
    expect(out.insights.map((i) => i.title)).toEqual(["The audit step holds up the whole line"]);
    expect(out.rejected.map((r) => r.problems[0]!.text)).toContain("£99,999");
    expect(out.dropped).toBe(0);
  });

  it("keeps the first draft's good items when the redraft still has a bad one, and counts what was dropped", async () => {
    const bad = good();
    bad.insights.push({ title: "Leads wait 4,321 days", type: "delay", rating: "bad", stepId: null, evidence: "Leads wait 4,321 days.", why: "Slow." });
    const out = await analyseWithAi(input, fake(() => bad));
    expect(out.status).toBe("ok");
    expect(out.insights).toHaveLength(1);
    expect(out.dropped).toBe(1);
    expect(out.rejected.some((r) => r.problems.some((p) => p.text.includes("4,321")))).toBe(true);
  });

  it("drops the read, not the insights, when only the read cites a bad figure", async () => {
    const bad = { ...good(), read: ["Northbeam wins 400 items a week."] };
    const out = await analyseWithAi(input, fake(() => bad));
    expect(out.status).toBe("ok");
    expect(out.summary).toEqual([]);
    expect(out.insights).toHaveLength(1);
    expect(out.reason).toContain("the read was left out");
  });

  it("fails, saying why, when every draft cites figures that aren't in the run", async () => {
    const bad = { read: ["Wins are up 400%."], insights: [{ title: "Costs £1,234,567", type: "idea", rating: "good", stepId: null, evidence: "It costs £1,234,567.", why: "x" }], review: [{ step: "job", level: "warn", text: "It takes 4,321 days." }] };
    const m = fake(() => bad);
    const out = await analyseWithAi(input, m);
    expect(m.calls).toHaveLength(2);
    expect(out).toMatchObject({ status: "failed", summary: [], insights: [], review: [] });
    expect(out.reason).toMatch(/every draft cited figures that aren't in the run/);
  });

  it("drops a quotation that isn't in the sources it was given, and keeps a real one", async () => {
    expect(quotationProblems('She said "Most weeks that\'s my Sunday, honestly" to us.', input.quotes)).toEqual([]);
    expect(quotationProblems('She said "We never sleep and always chase leads" to us.', input.quotes)).toHaveLength(1);
    const real = good();
    real.insights[0]!.why = "Maya says “Most weeks that's my Sunday, honestly”, which is the same load.";
    expect((await analyseWithAi(input, fake(() => real))).insights).toHaveLength(1);
    const made = good();
    made.insights[0]!.why = "Maya says “I would rather quit than do another audit”.";
    const out = await analyseWithAi(input, fake(() => made));
    expect(out.insights).toHaveLength(0);
    expect(out.rejected.some((r) => r.problems.some((p) => p.reason.includes("quotation")))).toBe(true);
  });

  it("turns unknown steps into no step, never keeps an unknown type, and caps the lists", async () => {
    const draft = good();
    draft.insights[0]!.stepId = "not-a-step";
    draft.insights.push({ title: "Odd", type: "perception_gap", rating: "bad", stepId: null, evidence: "Odd.", why: "x" });
    const out = await analyseWithAi(input, fake(() => draft));
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]!.stepId).toBeNull();
  });

  it("is unavailable, without calling anything, when there is no model (no API key)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
    const out = await analyseWithAi(input, null);
    expect(out).toMatchObject({ status: "unavailable", summary: [], insights: [] });
    expect(out.reason).toMatch(/isn't set up/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("turns refusals, timeouts and errors into a failure with the reason, and never throws", async () => {
    for (const [err, text] of [
      [new NarrationError("refused", "declined"), /declined/],
      [new NarrationError("timeout", "slow"), /in time/],
      [new NarrationError("error", "boom"), /boom/],
      [new Error("surprise"), /surprise/],
    ] as const) {
      const out = await analyseWithAi(input, fake(() => err));
      expect(out.status).toBe("failed");
      expect(out.reason).toMatch(text);
    }
    expect((await analyseWithAi(input, fake(() => new NarrationError("unavailable", "the key was refused")))).status).toBe("unavailable");
  });

  it("keeps the first draft's good items when the redraft can't be had", async () => {
    const bad = good();
    bad.insights.push({ title: "Costs £5,555,555", type: "idea", rating: "good", stepId: null, evidence: "It costs £5,555,555.", why: "x" });
    const out = await analyseWithAi(input, fake(() => bad, () => new NarrationError("timeout", "slow")));
    expect(out.status).toBe("ok");
    expect(out.insights).toHaveLength(1);
  });

  it("gives up on the redraft when there is no time left", async () => {
    const bad = { ...good(), read: ["Wins are up 400%."] };
    let t = 0;
    const m = fake(() => bad);
    await analyseWithAi(input, m, { budgetMs: 100_000, now: () => (t += 60_000) });
    expect(m.calls).toHaveLength(1);
  });
});

describe("AI insights in the insight list", () => {
  const detections = async () => aiDetections((await analyseWithAi(input, fake(() => good()))).insights);

  it("are marked AI, carry their own rating and why, and say there is no cost", async () => {
    const d = await detections();
    const insights = buildInsights(registerEntries([], d));
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ source: { kind: "ai", name: "AI" }, rating: "bad", title: "The audit step holds up the whole line", why: expect.stringContaining("Everything after it waits") });
    expect(insights[0]!.cost.perMonth).toBeNull();
    expect(insights[0]!.stepIds).toEqual([AUDIT]);
  });

  it("can be acknowledged into an issue, which keeps its key and then reads as that issue", async () => {
    const d = await detections();
    const store = new MemoryIssueStore("w1");
    const state = { promote: async (i: Parameters<MemoryIssueStore["promote"]>[0]) => { const r = await store.promote(i); return r.status === "ok" ? r.issue : null; } };
    const insight = buildInsights(registerEntries([], d))[0]!;
    const parsed = parsePromoteInput({ ...(await import("@/lib/issues/register")).promoteInput(insight.detection, bundle.process.id, []) });
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    const issue = await acknowledgeInsight(state, insight, { processId: bundle.process.id, scenarios: [] });
    expect(issue).toMatchObject({ detected_key: insight.key, source: "promoted", type: "bottleneck" });
    const again = buildInsights(registerEntries([issue!], d));
    expect(again[0]).toMatchObject({ issue: { id: issue!.id }, source: { kind: "ai" } });
  });

  it("can be dismissed, and then stay off the list", async () => {
    const d = await detections();
    const store = new MemoryIssueStore("w1");
    const state = { promote: async (i: Parameters<MemoryIssueStore["promote"]>[0]) => { const r = await store.promote(i); return r.status === "ok" ? r.issue : null; } };
    const insight = buildInsights(registerEntries([], d))[0]!;
    expect(await dismissInsight(state, insight, { processId: bundle.process.id, scenarios: [] })).toBe(true);
    const issues = [...(store as unknown as { rows: Map<string, never> }).rows.values()];
    expect(buildInsights(registerEntries(issues as never, d))).toHaveLength(0);
  });

  it("are read forgivingly from storage: a bad row is left out", () => {
    const stored = [
      { key: "ai:insight:abc123", type: "delay", rating: "bad", title: "Fine", evidence: "e", why: "w", stepId: null },
      { key: "capacity:role:x", type: "delay", rating: "bad", title: "Wrong key", evidence: "e", why: "w", stepId: null },
      { key: "ai:insight:def456", type: "perception_gap", rating: "bad", title: "Wrong type", evidence: "e", why: "w", stepId: null },
      "nonsense",
    ];
    expect(readInsights(stored).map((i) => i.title)).toEqual(["Fine"]);
    const view = aiViewFromRow({ id: "1", workspace_id: "w", process_id: "p", revision_id: "r", status: "ok", reason: null, trigger: "publish", summary: ["One.", 3, ""], insights: stored, review: [{ step: "job", level: "warn", text: "t" }, { step: "x", level: "warn", text: "t" }], checked: 3, dropped: 1, input_hash: "h", model: "m", usage: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
    expect(view).toMatchObject({ summary: ["One."], review: [{ step: "job" }], checked: 3, dropped: 1 });
    expect(view.review).toHaveLength(1);
  });
});

describe("the findings the model is given are the ones the pages show", () => {
  it("are rule findings, none of them AI's", () => {
    const keys = findings.map((f: DetectedIssue) => f.key);
    expect(keys.every((k) => !k.startsWith("ai:"))).toBe(true);
  });
});
