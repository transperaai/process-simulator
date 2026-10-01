import { describe, expect, it, vi } from "vitest";
import { AI_DAILY_RUN_LIMIT, DEFAULT_AI_SETTINGS, toEngineModel, type SaveAiAnalysisInput } from "@transpera-flow/db";
import { absenceTest, simulate } from "@transpera-flow/engine";
import type { AiDraftRequest, AiModel } from "@/lib/ai/analyse";
import { AI_MARKET_DEBOUNCE_MS, debouncedMarketRun, runAnalysis, type AiRunDeps, type MarketRunDeps } from "@/lib/ai/service";
import { demoFirstPrinciples } from "@/lib/first-principles/demo-seed";
import { demoBundle } from "@/lib/sources/demo";

vi.mock("server-only", () => ({}));

// When AI analysis runs, and what it stores (issue #111, A46): on a publish and on a market change when the switch is
// on, never for a viewer, never without a key, not for a version it has just done, and every outcome stored per version.
// The model is a fake: tests never call the Anthropic API.

const bundle = demoBundle();
const model = toEngineModel(bundle);
const result = simulate(model, 10, 1);

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
    reserve: async () => ({ status: "ok", runId: "run-1" }),
    build: async () => {
      d.built++;
      return { bundle, model, result, firstPrinciples: demoFirstPrinciples() };
    },
    model: fakeModel(),
    save: async (row) => {
      saved.push(row);
      return true;
    },
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
    const existing = { input_hash: stored.input_hash, status: "ok" };
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
    const existing = { input_hash: first.saved[0]!.input_hash, status: "failed" };
    expect((await runAnalysis(deps({ existing }))).status).toBe("stored");
  });

  it("reserves a run before every model call, on every trigger, including Run again and runs that will fail", async () => {
    for (const [trigger, force] of [["publish", false], ["market", false], ["manual", true]] as const) {
      const calls: string[] = [];
      const m = fakeModel({ read: ["It earns £9,876,543."], insights: [], review: [] });
      const d = deps({
        trigger,
        force,
        model: m,
        reserve: async () => {
          calls.push(`reserve:${m.calls.length}`);
          return { status: "ok", runId: "run-1" };
        },
      });
      await runAnalysis(d);
      expect(calls, trigger).toEqual(["reserve:0"]);
      expect(m.calls.length, trigger).toBeGreaterThan(0);
      expect(d.saved[0], trigger).toMatchObject({ run_id: "run-1", status: "failed" });
    }
  });

  it("calls nothing and stores nothing when the database refuses the run: the daily cap, the cooldown, or no right", async () => {
    for (const [reservation, why] of [
      [{ status: "limit" }, "limit"],
      [{ status: "cooldown", retryAfterSeconds: 42 }, "cooldown"],
      [{ status: "forbidden" }, "forbidden"],
    ] as const) {
      for (const force of [false, true]) {
        const m = fakeModel();
        const d = deps({ model: m, force, trigger: force ? "manual" : "publish", reserve: async () => reservation });
        const out = await runAnalysis(d);
        expect(out, `${why} force=${force}`).toMatchObject({ status: "skipped", why });
        expect(m.calls).toEqual([]);
        expect(d.saved).toEqual([]);
      }
    }
    const cool = await runAnalysis(deps({ reserve: async () => ({ status: "cooldown", retryAfterSeconds: 42 }) }));
    expect(cool).toMatchObject({ message: expect.stringContaining("42 seconds") });
    const lim = await runAnalysis(deps({ reserve: async () => ({ status: "limit" }) }));
    expect(lim).toMatchObject({ message: expect.stringContaining(`${AI_DAILY_RUN_LIMIT} AI runs`) });
    expect(await runAnalysis(deps({ reserve: async () => ({ status: "error" }) }))).toMatchObject({ status: "error" });
  });

  it("doesn't reserve for a run it skips before the model: switched off, no key, unchanged, no first principles", async () => {
    let reserved = 0;
    const reserve = async () => {
      reserved++;
      return { status: "ok" as const, runId: "r" };
    };
    await runAnalysis(deps({ reserve, settings: { ...DEFAULT_AI_SETTINGS, review_on_publish: false } }));
    await runAnalysis(deps({ reserve, model: null }));
    await runAnalysis(deps({ reserve, build: async () => ({ bundle, model, result, firstPrinciples: null }) }));
    expect(reserved).toBe(0);
  });
});

describe("debouncedMarketRun", () => {
  const run = (over: Partial<MarketRunDeps> = {}) => {
    const log: string[] = [];
    const deps: MarketRunDeps = {
      mark: async () => "m1",
      sleep: async () => {},
      claim: async () => true,
      processes: async () => ["p1", "p2", "p3"],
      run: async (id) => void log.push(id),
      log: (m) => void log.push(`log:${m}`),
      ...over,
    };
    return { deps, log };
  };

  it("waits, claims its mark, and reviews each process once", async () => {
    const slept: number[] = [];
    const { deps, log } = run({ sleep: async (ms) => void slept.push(ms) });
    expect(await debouncedMarketRun(deps)).toEqual({ ran: ["p1", "p2", "p3"], skipped: [] });
    expect(slept).toEqual([AI_MARKET_DEBOUNCE_MS]);
    expect(log).toEqual(["p1", "p2", "p3"]);
  });

  it("a burst of changes makes one review: only the last change still holds the mark", async () => {
    let pending: string | null = null;
    let n = 0;
    const reviewed: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const make = () =>
      run({
        mark: async () => (pending = `m${++n}`),
        sleep: () => gate,
        claim: async (m) => {
          if (pending !== m) return false;
          pending = null;
          return true;
        },
        run: async (id) => void reviewed.push(id),
      }).deps;
    const all = Promise.all(Array.from({ length: 5 }, () => debouncedMarketRun(make())));
    await new Promise((r) => setTimeout(r, 0));
    release();
    const outs = await all;
    expect(outs.filter((o) => o.ran.length)).toHaveLength(1);
    expect(reviewed).toEqual(["p1", "p2", "p3"]);
  });

  it("does nothing when the mark can't be written or was taken over by a later change", async () => {
    const a = run({ mark: async () => null });
    expect(await debouncedMarketRun(a.deps)).toEqual({ ran: [], skipped: [] });
    const b = run({ claim: async () => false });
    expect(await debouncedMarketRun(b.deps)).toEqual({ ran: [], skipped: [] });
    expect(b.log).toEqual([]);
  });

  it("stops starting reviews once the time budget is spent, and logs the ones it left; never more than 5", async () => {
    let t = 0;
    const { deps, log } = run({ processes: async () => ["p1", "p2", "p3", "p4", "p5", "p6", "p7"], now: () => t, run: async (id) => { log.push(id); t += 60_000; } });
    const out = await debouncedMarketRun(deps);
    expect(out.ran).toEqual(["p1", "p2", "p3"]);
    expect(out.skipped).toEqual(["p4", "p5"]);
    expect(log.some((l) => l.startsWith("log:AI market review: left"))).toBe(true);
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
