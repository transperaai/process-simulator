import { describe, expect, it } from "vitest";
import {
  MemoryRobustnessCache,
  RobustnessCancelled,
  RobustnessPool,
  applyPatches,
  checkRobustness,
  compareRuns,
  estimatedParameters,
  handleRobustnessRequest,
  northbeamModel,
  plannedReplications,
  poolSize,
  provenanceSource,
  robustness,
  robustnessVerdict,
  runRobustnessTask,
  simulate,
  type ChunkResult,
  type PoolWorker,
  type RobustnessExecutor,
  type RobustnessRequest,
  type RobustnessResponse,
  type RobustnessResult,
  type ScenarioPatch,
} from "../src";

const hire: ScenarioPatch[] = [{ path: "roles.strat.headcount", op: "add", value: 1 }];
/** A small, quick check: a handful of parameters. */
const quick = {
  parameters: [
    { path: "demand.leads_per_week", low: 0.75, high: 1.25 },
    { path: "steps.audit.work_hours", low: 0.75, high: 1.25 },
    { path: "steps.discovery.work_hours", low: 0.75, high: 1.25 },
  ],
  refineTop: 2,
};
const withoutStats = ({ stats: _stats, ...rest }: RobustnessResult) => rest;

/** An executor that counts the tasks it runs. */
function counting(): { execute: RobustnessExecutor; runs: () => number } {
  let n = 0;
  return {
    execute: async (tasks, { onResult }) =>
      tasks.map((t, i) => {
        n++;
        const r = runRobustnessTask(t);
        onResult(i, r);
        return r;
      }),
    runs: () => n,
  };
}

describe("which parameters are estimated", () => {
  it("treats a field as estimated unless its provenance says entered or measured", () => {
    expect(provenanceSource(undefined, "work_hours")).toBe("estimated");
    expect(provenanceSource({}, "work_hours")).toBe("estimated");
    expect(provenanceSource({ source: "entered" }, "work_hours")).toBe("entered");
    expect(provenanceSource({ source: "guess" }, "work_hours")).toBe("estimated");
    // Per-column entries win over the row's source; a column without one falls back to it.
    expect(provenanceSource({ source: "entered", work_hours: { source: "estimated" } }, "work_hours")).toBe("estimated");
    expect(provenanceSource({ wait_hours: { source: "measured" } }, "wait_hours")).toBe("measured");
    expect(provenanceSource({ wait_hours: { source: "measured" } }, "work_hours")).toBe("estimated");
  });

  it("lists every non-zero input that can move wins or the bottleneck, leaving out known ones", () => {
    const model = northbeamModel();
    const all = estimatedParameters(model).map((p) => p.path);
    expect(all).toContain("demand.leads_per_week");
    expect(all).toContain("steps.audit.work_hours");
    expect(all).toContain("roles.strat.ongoing_hours");
    expect(all.some((p) => p.endsWith("cost_rate") || p.endsWith("headcount") || p === "finances.retainer")).toBe(false);
    // Zero values have nothing to perturb.
    for (const s of model.steps) if (s.wait === 0) expect(all).not.toContain(`steps.${s.id}.wait_hours`);
    // Money inputs only matter to the MRR metric.
    expect(estimatedParameters(model, { metric: "mrrAdded" }).map((p) => p.path)).toContain("finances.retainer");

    const known = estimatedParameters(model, {
      provenance: (t) => (t.kind === "steps" && t.id === "audit" ? { source: "measured" } : t.kind === "demand" ? { leads_per_week: { source: "entered" } } : undefined),
    }).map((p) => p.path);
    expect(known).not.toContain("steps.audit.work_hours");
    expect(known).not.toContain("demand.leads_per_week");
    expect(known).toContain("demand.churn_monthly");
  });

  it("uses a conflicted field's actual range instead of ±25%", () => {
    const model = northbeamModel();
    const audit = model.steps.find((s) => s.id === "audit")!;
    const [p] = estimatedParameters(model, {
      provenance: (t) =>
        t.kind === "steps" && t.id === "audit"
          ? { work_hours: { source: "estimated", conflict: { values: [{ value: audit.work / 2 }, { value: audit.work * 2 }] } } }
          : { source: "entered" },
    });
    expect(p).toEqual({ path: "steps.audit.work_hours", low: 0.5, high: 2, conflict: true });
  });
});

describe("robustness check", () => {
  it("reproduces the compare view's numbers for the unperturbed runs", () => {
    const model = northbeamModel();
    const r = robustness(model, hire, quick);
    const base = simulate(model, 30, 1);
    const scen = simulate(applyPatches(model, hire).model, 30, 1);
    const c = compareRuns(base, scen);
    expect(r.nominal.delta).toBeCloseTo(c.won.delta.mean, 9);
    expect(r.nominal.bottleneck).toEqual({ baseline: base.bnRole, scenario: scen.bnRole });
  });

  it("screens every parameter both ways, then refines the top ones at 30 replications", () => {
    const r = robustness(northbeamModel(), hire, quick);
    expect(r.parameters).toBe(3);
    expect(r.screened).toBe(3);
    expect(r.refined).toBe(2);
    expect(r.runs).toBe(6);
    expect(r.sensitivities.filter((s) => s.refined).map((s) => s.reps)).toEqual([30, 30]);
    expect(r.sensitivities.filter((s) => !s.refined).map((s) => s.reps)).toEqual([10]);
    expect(r.complete).toBe(true);
    // Nominal 3 chunks + 6 screen jobs, then 2 parameters × 2 directions × 2 more chunks.
    expect(r.stats.jobs).toBe(3 + 6 + 8);
    expect(r.stats.replications).toBe(plannedReplications({ parameters: quick.parameters, screenReps: 10, refineReps: 30, refineTop: 2 }));
    expect(r.bottleneckHolds.both).toBeLessThanOrEqual(Math.min(r.bottleneckHolds.baseline, r.bottleneckHolds.scenario));
    for (const share of [r.signHolds, r.bottleneckHolds.baseline, r.bottleneckHolds.scenario, r.bottleneckHolds.both]) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it("ranks inputs by how much they move the delta, with effect sizes", () => {
    const r = robustness(northbeamModel(), hire, quick);
    const flipsFirst = r.sensitivities.map((s) => s.flipsSign);
    expect(flipsFirst).toEqual([...flipsFirst].sort((a, b) => Number(b) - Number(a)));
    for (const s of r.sensitivities) {
      expect(s.influence).toBe(Math.max(Math.abs(s.effect.low!), Math.abs(s.effect.high!)));
      expect(s.label).toMatch(/Leads per week|: hands-on time/);
    }
  });

  it("a hire at the bottleneck that adds wins holds up, and more leads matter to it", () => {
    const r = robustness(northbeamModel(), hire, { ...quick, parameters: [...quick.parameters, { path: "demand.churn_monthly", low: 0.75, high: 1.25 }] });
    expect(r.nominal.sign).toBe(1);
    expect(r.nominal.bottleneck.baseline).toBe("strat");
    expect(r.signHolds).toBe(1);
    // Sorted by influence when nothing flips the answer: leads move the gain
    // from a hire most, and churn barely touches pipeline wins.
    expect(r.sensitivities.map((s) => s.influence)).toEqual(r.sensitivities.map((s) => s.influence).sort((a, b) => b - a));
    expect(r.sensitivities[0]!.path).toBe("demand.leads_per_week");
    expect(r.sensitivities.find((s) => s.path === "demand.churn_monthly")!.refined).toBe(false);
  });

  it("is deterministic for a seed, whatever runs the jobs and whatever is cached", async () => {
    const model = northbeamModel();
    const a = robustness(model, hire, quick);
    const b = await checkRobustness(model, hire, quick);
    expect(withoutStats(b)).toEqual(withoutStats(a));
    const half = new MemoryRobustnessCache();
    robustness(model, hire, { ...quick, refineTop: 0, cache: half });
    const c = robustness(model, hire, { ...quick, cache: half });
    expect(c.stats.cached).toBeGreaterThan(0);
    expect(withoutStats(c)).toEqual(withoutStats(a));
    expect(withoutStats(robustness(model, hire, { ...quick, seed: 2 }))).not.toEqual(withoutStats(a));
  });

  it("gives every perturbed run and the baseline the same random streams", () => {
    // A perturbation that changes nothing (×1) reproduces the nominal runs exactly.
    const model = northbeamModel();
    const job = { path: "steps.audit.work_hours", factor: 1, seed: 1, repStart: 0, reps: 10 };
    expect(runRobustnessTask({ model, scenario: hire, job })).toEqual(runRobustnessTask({ model, scenario: hire, job: { ...job, path: null } }));
    // Chunks are the same replications as one long run.
    const whole = runRobustnessTask({ model, scenario: hire, job: { ...job, reps: 20 } });
    const second = runRobustnessTask({ model, scenario: hire, job: { ...job, repStart: 10 } });
    expect(second.baseline.won).toEqual(whole.baseline.won.slice(10));
  });
});

describe("cache", () => {
  it("re-opening compare on an unchanged model reuses the cached results without re-running", async () => {
    const model = northbeamModel();
    const cache = new MemoryRobustnessCache();
    const first = counting();
    const a = await checkRobustness(model, hire, { ...quick, cache, execute: first.execute });
    expect(first.runs()).toBe(17);
    expect(a.stats.cached).toBe(0);

    // Same model (a fresh copy, keys in another order) and scenario: nothing runs.
    const again = counting();
    const reordered = Object.fromEntries(Object.entries(structuredClone(model)).reverse()) as unknown as typeof model;
    const b = await checkRobustness(reordered, [...hire], { ...quick, cache, execute: again.execute });
    expect(again.runs()).toBe(0);
    expect(b.stats.cached).toBe(17);
    expect(withoutStats(b)).toEqual(withoutStats(a));
    expect(robustness(model, hire, { ...quick, cache, cacheOnly: true })).not.toBeNull();

    // A changed model or scenario misses.
    const changed = structuredClone(model);
    changed.leadsPerWeek += 1;
    expect(robustness(changed, hire, { ...quick, cache, cacheOnly: true })).toBeNull();
    expect(robustness(model, [{ ...hire[0]!, value: 2 }], { ...quick, cache, cacheOnly: true })).toBeNull();
  });

  it("keeps the jobs a cancelled check finished, so checking again resumes", async () => {
    const model = northbeamModel();
    const cache = new MemoryRobustnessCache();
    const controller = new AbortController();
    const stopped = checkRobustness(model, hire, {
      ...quick,
      cache,
      signal: controller.signal,
      onProgress: (p) => p.done >= 60 && controller.abort(),
    });
    await expect(stopped).rejects.toBeInstanceOf(RobustnessCancelled);
    const resumed = counting();
    const r = await checkRobustness(model, hire, { ...quick, cache, execute: resumed.execute });
    expect(r.stats.cached).toBeGreaterThanOrEqual(3);
    expect(resumed.runs()).toBe(17 - r.stats.cached);
    expect(withoutStats(r)).toEqual(withoutStats(robustness(model, hire, quick)));
  });

  it("keys by model hash, scenario hash, parameter and perturbation", async () => {
    const model = northbeamModel();
    const cache = new MemoryRobustnessCache();
    await checkRobustness(model, hire, { ...quick, cache });
    // A wider perturbation of the same parameters reuses only the unperturbed runs.
    const wider = counting();
    await checkRobustness(model, hire, {
      ...quick,
      parameters: quick.parameters.map((p) => ({ ...p, low: 0.5, high: 1.5 })),
      cache,
      execute: wider.execute,
    });
    expect(wider.runs()).toBe(17 - 3);
  });
});

describe("time-capped Node entry point", () => {
  it("always finishes the unperturbed runs, then stops starting jobs once the budget is spent", () => {
    let t = 0;
    // Each clock read advances 1 ms: the budget runs out after a few jobs.
    const r = robustness(northbeamModel(), hire, { ...quick, timeBudgetMs: 4, now: () => t++ });
    expect(r.complete).toBe(false);
    expect(r.screened).toBeLessThan(3);
    expect(r.nominal.bottleneck.baseline).toBe("strat");
    expect(robustnessVerdict({ result: r, subject: "“Hire”", roleNames: { strat: "Strategist" }, horizonWeeks: 13 }).details.join(" ")).toMatch(
      /Stopped early: \d of 3 inputs checked/,
    );
  });

  it("with a generous budget runs the whole check", () => {
    const r = robustness(northbeamModel(), hire, { ...quick, timeBudgetMs: 60_000 });
    expect(r.complete).toBe(true);
    expect(r.screened).toBe(3);
  });

  it("runs the default parameter set on Northbeam within a couple of seconds", () => {
    const t = performance.now();
    const r = robustness(northbeamModel(), hire);
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(r.parameters).toBe(estimatedParameters(northbeamModel()).length);
    expect(r.refined).toBe(5);
  });
});

describe("verdict", () => {
  it("fills fixed templates from the result", () => {
    const r = robustness(northbeamModel(), hire, quick);
    const v = robustnessVerdict({ result: r, subject: "“Hire a strategist”", roleNames: { strat: "Strategist" }, horizonWeeks: 13 });
    expect(v.verdict).toMatch(/^Strategist is the bottleneck (in|today in) \d+% of cases.*; “Hire a strategist” adds wins in \d+% of cases\.$/);
    expect(v.sensitive).toHaveLength(3);
    expect(v.sensitive[0]!.effect).toMatch(/^−25%: .*; \+25%: /);
  });

  it("never rounds a share that isn't 100% up to 100%", () => {
    const base = robustness(northbeamModel(), hire, quick);
    const r: RobustnessResult = { ...base, signHolds: 0.996, bottleneckHolds: { baseline: 1, scenario: 1, both: 1 }, nominal: { ...base.nominal, sign: 1 } };
    expect(robustnessVerdict({ result: r, subject: "X", roleNames: {}, horizonWeeks: 13 }).verdict).toMatch(/adds wins in 99% of cases/);
  });
});

// ---------------------------------------------------------------------------
// Worker pool, with fake workers that answer on a later tick.
// ---------------------------------------------------------------------------

class FakeWorker implements PoolWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((event: { data: RobustnessResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  posted = 0;
  constructor() {
    FakeWorker.created++;
  }
  postMessage(message: RobustnessRequest) {
    this.posted++;
    setTimeout(() => this.onmessage?.({ data: handleRobustnessRequest(message) }), 0);
  }
  terminate() {
    FakeWorker.terminated++;
    this.onmessage = null;
  }
}

describe("worker pool", () => {
  it("sizes itself at one worker per core minus one, at least one", () => {
    expect(poolSize(8)).toBe(7);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(undefined)).toBe(1);
  });

  it("spreads jobs across workers and gives the same result as one thread, with progress", async () => {
    FakeWorker.created = 0;
    const pool = new RobustnessPool(() => new FakeWorker(), 3);
    const progress: number[] = [];
    const r = await checkRobustness(northbeamModel(), hire, { ...quick, execute: pool.execute, onProgress: (p) => progress.push(p.done / p.total) });
    expect(FakeWorker.created).toBe(3);
    expect(withoutStats(r)).toEqual(withoutStats(robustness(northbeamModel(), hire, quick)));
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    pool.dispose();
  });

  it("cancels: rejects, and stops the busy workers", async () => {
    FakeWorker.terminated = 0;
    const pool = new RobustnessPool(() => new FakeWorker(), 2);
    const controller = new AbortController();
    const running = checkRobustness(northbeamModel(), hire, {
      ...quick,
      execute: pool.execute,
      signal: controller.signal,
      onProgress: (p) => p.done > 0 && controller.abort(),
    });
    await expect(running).rejects.toBeInstanceOf(RobustnessCancelled);
    expect(FakeWorker.terminated).toBeGreaterThan(0);
    // The pool still works afterwards.
    const chunk: ChunkResult[] = await pool.execute([{ model: northbeamModel(), scenario: hire, job: { path: null, factor: 1, seed: 1, repStart: 0, reps: 2 } }], {
      onResult: () => {},
    });
    expect(chunk[0]!.baseline.won).toHaveLength(2);
    pool.dispose();
  });

  it("reports a worker's error", async () => {
    const pool = new RobustnessPool(() => new FakeWorker(), 2);
    const broken = { ...northbeamModel(), entry: "nowhere" };
    await expect(pool.execute([{ model: broken, scenario: [], job: { path: null, factor: 1, seed: 1, repStart: 0, reps: 1 } }], { onResult: () => {} })).rejects.toThrow();
    pool.dispose();
  });
});
