import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS, toEngineModel, type SaveAiAnalysisInput } from "@transpera-flow/db";
import { absenceTest, simulate } from "@transpera-flow/engine";
import type { AiDraftRequest, AiModel } from "@/lib/ai/analyse";
import { AI_DAILY_LIMIT, AI_MIN_GAP_MS, runAnalysis, type AiRunDeps } from "@/lib/ai/service";
import { demoFirstPrinciples } from "@/lib/first-principles/demo-seed";
import { demoBundle } from "@/lib/sources/demo";

vi.mock("server-only", () => ({}));

// When AI analysis runs, and what it stores (issue #111, A46): on a publish and on a market change when the switch is
// on, never for a viewer, never without a key, not for a version it has just done, and every outcome stored per version.
// The model is a fake: tests never call the Anthropic API.

const bundle = demoBundle();
const model = toEngineModel(bundle);
const result = simulate(model, 10, 1);
const NOW = new Date("2026-10-01T12:00:00Z");

function fakeModel(output: unknown = { read: ["Fine."], insights: [], review: [] }): AiModel & { calls: AiDraftRequest[] } {
  const calls: AiDraftRequest[] = [];
  return {
    name: "fake",
    calls,
    async draft(req) {
      calls.push(req);
      return { output, model: "fake", usage: null };
    },
  };
}

function deps(over: Partial<AiRunDeps> = {}): AiRunDeps & { saved: SaveAiAnalysisInput[]; built: number } {
  const saved: SaveAiAnalysisInput[] = [];
  const d: AiRunDeps & { saved: SaveAiAnalysisInput[]; built: number } = {
    trigger: "publish",
    force: false,
    workspaceId: "w",
    processId: "p",
    revisionId: "r1",
    settings: { ...DEFAULT_AI_SETTINGS },
    canWrite: true,
    existing: null,
    countToday: 0,
    build: async () => {
      d.built++;
      return { bundle, model, result, firstPrinciples: demoFirstPrinciples() };
    },
    model: fakeModel(),
    save: async (row) => {
      saved.push(row);
      return true;
    },
    now: () => NOW,
    saved,
    built: 0,
    ...over,
  };
  return d;
}

describe("runAnalysis: when it runs", () => {
  it("runs on a publish and stores the outcome against the version", async () => {
    const d = deps();
    const out = await runAnalysis(d);
    expect(out.status).toBe("stored");
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({ workspace_id: "w", process_id: "p", revision_id: "r1", status: "ok", trigger: "publish", summary: ["Fine."], model: "fake" });
    expect(d.saved[0]!.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does nothing when the matching switch is off, and doesn't even simulate", async () => {
    for (const [trigger, key] of [["publish", "review_on_publish"], ["market", "review_on_market"]] as const) {
      const d = deps({ trigger, settings: { ...DEFAULT_AI_SETTINGS, [key]: false } });
      expect(await runAnalysis(d)).toEqual({ status: "skipped", why: "switched_off" });
      expect(d.built).toBe(0);
      expect(d.saved).toEqual([]);
    }
  });

  it("a switch for one trigger doesn't stop the other, or a manual run", async () => {
    const settings = { ...DEFAULT_AI_SETTINGS, review_on_publish: false, review_on_market: false };
    expect((await runAnalysis(deps({ trigger: "manual", settings }))).status).toBe("stored");
    expect((await runAnalysis(deps({ trigger: "market", settings: { ...DEFAULT_AI_SETTINGS, review_on_publish: false } }))).status).toBe("stored");
    expect((await runAnalysis(deps({ trigger: "publish", settings: { ...DEFAULT_AI_SETTINGS, review_on_market: false } }))).status).toBe("stored");
  });

  it("fails gracefully with no API key: nothing is simulated, called or stored", async () => {
    const d = deps({ model: null });
    expect(await runAnalysis(d)).toEqual({ status: "skipped", why: "not_set_up" });
    expect(d.built).toBe(0);
    expect(d.saved).toEqual([]);
  });

  it("is refused for someone who can't write (a viewer or member), before anything runs", async () => {
    const m = fakeModel();
    const d = deps({ canWrite: false, model: m });
    expect(await runAnalysis(d)).toEqual({ status: "skipped", why: "forbidden" });
    expect(m.calls).toEqual([]);
    expect(d.built).toBe(0);
  });

  it("skips a process with no live version", async () => {
    expect(await runAnalysis(deps({ revisionId: null }))).toEqual({ status: "skipped", why: "no_live" });
  });

  it("needs first principles to review: without them nothing is called or stored", async () => {
    const m = fakeModel();
    const d = deps({ model: m, build: async () => ({ bundle, model, result, firstPrinciples: null }) });
    expect(await runAnalysis(d)).toEqual({ status: "skipped", why: "no_first_principles" });
    expect(m.calls).toEqual([]);
    expect(d.saved).toEqual([]);
  });

  it("reports a model that can't be built, saving nothing", async () => {
    const d = deps({ build: async () => ({ error: "A step has no role." }) });
    expect(await runAnalysis(d)).toEqual({ status: "skipped", why: "model_error", message: "A step has no role." });
    expect(d.saved).toEqual([]);
  });
});

describe("runAnalysis: not regenerated for nothing", () => {
  it("skips a version whose stored analysis was made from the same facts, unless asked to run again", async () => {
    const first = deps();
    await runAnalysis(first);
    const stored = first.saved[0]!;
    const existing = { input_hash: stored.input_hash, status: "ok", updated_at: new Date(NOW.getTime() - 3_600_000).toISOString() };
    const m = fakeModel();
    expect(await runAnalysis(deps({ existing, model: m }))).toEqual({ status: "skipped", why: "unchanged" });
    expect(m.calls).toEqual([]);
    const again = deps({ existing, force: true, trigger: "manual", model: m });
    expect((await runAnalysis(again)).status).toBe("stored");
    expect(m.calls).toHaveLength(1);
  });

  it("redoes a stored failure (it can't be 'unchanged' if nothing was written)", async () => {
    const first = deps();
    await runAnalysis(first);
    const existing = { input_hash: first.saved[0]!.input_hash, status: "failed", updated_at: new Date(NOW.getTime() - 3_600_000).toISOString() };
    expect((await runAnalysis(deps({ existing }))).status).toBe("stored");
  });

  it("an automatic market trigger waits out the gap since the last analysis; a publish and a manual run don't", async () => {
    const existing = { input_hash: "old", status: "ok", updated_at: new Date(NOW.getTime() - AI_MIN_GAP_MS + 1000).toISOString() };
    expect(await runAnalysis(deps({ trigger: "market", existing }))).toEqual({ status: "skipped", why: "recent" });
    expect((await runAnalysis(deps({ trigger: "publish", existing }))).status).toBe("stored");
    expect((await runAnalysis(deps({ trigger: "manual", force: true, existing }))).status).toBe("stored");
  });

  it("stops at the workspace's daily limit", async () => {
    const m = fakeModel();
    const out = await runAnalysis(deps({ countToday: AI_DAILY_LIMIT, model: m }));
    expect(out).toMatchObject({ status: "skipped", why: "limit" });
    expect(m.calls).toEqual([]);
  });
});

describe("runAnalysis: what is stored", () => {
  it("stores a failure with its reason, so the page can say why", async () => {
    const d = deps({ model: fakeModel({ read: ["It earns £9,876,543."], insights: [], review: [] }) });
    const out = await runAnalysis(d);
    expect(out.status).toBe("stored");
    expect(d.saved[0]).toMatchObject({ status: "failed", summary: [], insights: [], review: [] });
    expect(d.saved[0]!.reason).toMatch(/aren't in the run/);
  });

  it("stores only items that passed the number check", async () => {
    const d = deps({
      model: fakeModel({
        read: ["Fine."],
        insights: [{ title: "Costs £9,876,543 a month", type: "delay", rating: "bad", stepId: null, evidence: "It costs £9,876,543.", why: "x" }],
        review: [{ step: "job", level: "info", text: "The job is clear." }],
      }),
    });
    await runAnalysis(d);
    expect(d.saved[0]).toMatchObject({ status: "ok", insights: [], review: [{ step: "job", level: "info", text: "The job is clear." }], dropped: 1 });
  });

  it("reports a save that failed", async () => {
    expect(await runAnalysis(deps({ save: async () => false }))).toEqual({ status: "error", message: "The analysis ran but couldn't be saved." });
  });

  it("includes source quotes only when the switch is on", async () => {
    const off = fakeModel();
    await runAnalysis(deps({ model: off }));
    expect(off.calls[0]!.facts).not.toContain("quotesFromSources");
    const on = fakeModel();
    await runAnalysis(deps({ model: on, settings: { ...DEFAULT_AI_SETTINGS, read_sources: true } }));
    expect(on.calls[0]!.facts).toContain("quotesFromSources");
    expect(on.calls[0]!.facts).toContain("twelve hours");
  });
});

describe("the extra runs the server makes are affordable", () => {
  it("rule 8's absence test on the Northbeam sample takes well under the request's time", () => {
    const t = Date.now();
    absenceTest(model, { seed: 1, weeks: 2 });
    expect(Date.now() - t).toBeLessThan(20_000);
  });
});
