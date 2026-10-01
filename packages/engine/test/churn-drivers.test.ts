import { describe, expect, it } from "vitest";
import {
  BUILTIN_CHURN_DRIVER_IDS,
  MARKET_PRESETS,
  churnCauseIssues,
  detectIssues,
  larkspurModel,
  northbeamWithChurnDrivers,
  northbeamWithClientGroups,
  northbeamWithServicing,
  projectChurn,
  resolveChurnDrivers,
  simulate,
  toRatingConfig,
  withMarketCondition,
  type EngineChurnDriver,
  type EngineModel,
} from "../src";

// Churn drivers (docs/PRD.md decision D31; issue #121): base churn × (1 + Σ weight × pressure) × market,
// and each driver's share of the churn.

const withDrivers = (model: EngineModel, churnDrivers: EngineChurnDriver[]): EngineModel => ({ ...model, churnDrivers });
const groups = northbeamWithClientGroups;
const churned = (m: EngineModel, reps = 30) => simulate(m, reps, 1).kpi.clientsChurned!.mean;

describe("resolving the drivers", () => {
  it("lists the ten built-ins in order, with only late work and the market on", () => {
    const d = resolveChurnDrivers({});
    expect(d.map((x) => x.id)).toEqual([...BUILTIN_CHURN_DRIVER_IDS]);
    expect(d.filter((x) => x.enabled).map((x) => x.id)).toEqual(["late", "market"]);
    expect(d.every((x) => x.weight === 1)).toBe(true);
  });

  it("brings weights and values into range, takes a repeated id's first entry and adds your own after the ten", () => {
    const d = resolveChurnDrivers({
      churnDrivers: [
        { id: "late", weight: 9, enabled: true },
        { id: "late", weight: 0.5, enabled: false },
        { id: "results", weight: -2, enabled: true, value: 40 },
        { id: "custom:a", name: "  ", weight: 2, enabled: true, value: 10 },
        { id: "bogus", weight: 1, enabled: true },
      ],
    });
    expect(d).toHaveLength(11);
    expect(d[0]).toMatchObject({ id: "late", weight: 3, enabled: true });
    expect(d.find((x) => x.id === "results")).toMatchObject({ weight: 0, value: 10 });
    expect(d[10]).toMatchObject({ id: "custom:a", name: "Your own driver", custom: true, value: 10, weight: 2 });
  });
});

describe("the defaults change nothing", () => {
  it("a model with no drivers and one with the defaults spelled out simulate to the same numbers, to the last digit", () => {
    const base = groups();
    const spelled = withDrivers(
      base,
      BUILTIN_CHURN_DRIVER_IDS.map((id) => ({ id, weight: 1, enabled: id === "late" || id === "market" })),
    );
    const a = simulate(base, 10, 3);
    const b = simulate(spelled, 10, 3);
    expect(b.kpi).toEqual(a.kpi);
    expect(b.clients).toEqual(a.clients);
    expect(b.churnCauses).toEqual(a.churnCauses);
  });

  it("is deterministic", () => {
    const m = northbeamWithChurnDrivers();
    expect(simulate(m, 6, 2).churnCauses).toEqual(simulate(m, 6, 2).churnCauses);
  });
});

describe("applying the drivers to churn", () => {
  it("switching late work off removes the health effect: fewer clients leave", () => {
    const on = churned(groups());
    const off = churned(withDrivers(groups(), [{ id: "late", weight: 1, enabled: false }]));
    expect(off).toBeLessThan(on);
  });

  it("weight 0 and off are the same", () => {
    const a = churned(withDrivers(groups(), [{ id: "late", weight: 0, enabled: true }]));
    const b = churned(withDrivers(groups(), [{ id: "late", weight: 1, enabled: false }]));
    expect(a).toBe(b);
  });

  it("a heavier weight on late work loses more clients, a lighter one fewer", () => {
    const at = (w: number) => churned(withDrivers(groups(), [{ id: "late", weight: w, enabled: true }]));
    expect(at(0.5)).toBeLessThan(at(1));
    expect(at(1)).toBeLessThan(at(2));
  });

  it("an entered driver (results rated 3 out of 10) adds churn; rated 9 adds none", () => {
    const base = churned(groups());
    const bad = churned(withDrivers(groups(), [{ id: "results", weight: 1, enabled: true, value: 3 }]));
    const good = churned(withDrivers(groups(), [{ id: "results", weight: 1, enabled: true, value: 9 }]));
    expect(bad).toBeGreaterThan(base);
    expect(good).toBe(base);
  });

  it("your own driver adds its extra churn; switched off it adds none", () => {
    const base = churned(groups());
    const mine = (enabled: boolean) => withDrivers(groups(), [{ id: "custom:x", name: "A rival", weight: 1, enabled, value: 100 }]);
    expect(churned(mine(true))).toBeGreaterThan(base);
    expect(churned(mine(false))).toBe(base);
  });

  it("a planned price rise only weighs on churn from its month, for three months", () => {
    const rise = (month: number) => simulate(withDrivers(groups(), [{ id: "price", weight: 1, enabled: true, value: 50, month }]), 20, 1).churnCauses!.causes.find((c) => c.id === "price")!;
    expect(rise(1).pressure).toBeGreaterThan(0);
    // Month 1 starts at the first tick; a rise in month 20 of a 26-week run never lands inside the three months it weighs.
    expect(rise(20).pressure).toBe(0);
    expect(rise(1).clients).toBeGreaterThan(0);
  });

  it("the market driver follows the market: off ignores a downturn's effect on churn, a heavier weight stretches it more", () => {
    const down = (market: EngineChurnDriver) => withDrivers(withMarketCondition(northbeamWithServicing(), MARKET_PRESETS.downturn.factors), [market]);
    const on = churned(down({ id: "market", weight: 1, enabled: true }));
    const off = churned(down({ id: "market", weight: 1, enabled: false }));
    const heavy = churned(down({ id: "market", weight: 3, enabled: true }));
    // The same demand either way (the downturn also cuts enquiries); only the market's weight on churn differs.
    expect(on).toBeGreaterThan(off);
    expect(heavy).toBeGreaterThan(on);
  });

  it("a model with no clients to count (the pooled model) is unchanged by drivers other than the market", () => {
    const pooled: EngineModel = { ...northbeamWithServicing(), clients: undefined, servicingProcesses: undefined, services: undefined };
    const a = simulate(pooled, 5, 1);
    const b = simulate(withDrivers(pooled, [{ id: "results", weight: 3, enabled: true, value: 0 }]), 5, 1);
    expect(a.churnCauses).toBeUndefined();
    expect(b.kpi).toEqual(a.kpi);
  });
});

describe("what the engine measures", () => {
  const run = simulate(northbeamWithChurnDrivers(), 30, 1);
  const cause = (id: string) => run.churnCauses!.causes.find((c) => c.id === id)!;

  it("reports every driver, the ten and your own, in order", () => {
    expect(run.churnCauses!.causes.map((c) => c.id)).toEqual([...BUILTIN_CHURN_DRIVER_IDS, "custom:competitor"]);
    expect(cause("custom:competitor")).toMatchObject({ name: "A competitor undercuts us", custom: true, value: 15 });
  });

  it("splits all the churn between normal churn and the drivers, so the shares add up to 1", () => {
    const c = run.churnCauses!;
    expect(c.normal.share + c.causes.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
    expect(c.clients).toBeGreaterThan(0);
    // The expected clients lost are close to the clients that actually left.
    expect(Math.abs(c.clients - run.kpi.clientsChurned!.mean) / run.kpi.clientsChurned!.mean).toBeLessThan(0.15);
    const bySvc = Object.values(c.byService).reduce((a, s) => a + s.clients, 0);
    expect(bySvc).toBeCloseTo(c.clients, 10);
  });

  it("measures late work from the servicing touchpoints, and the team's busiest person", () => {
    const t = run.kpi.touchpoints!;
    const late = (t.late.mean + t.missed.mean) / (t.onTime.mean + t.late.mean + t.missed.mean);
    expect(cause("late").value).toBeCloseTo(late, 2);
    expect(cause("late").share).toBeGreaterThan(0.2);
    expect(cause("load").value).toBeGreaterThan(0.5);
    expect(cause("load").valuePerson).toBeTruthy();
    expect(cause("onb").value).toBeGreaterThan(0);
  });

  it("a switched-off driver is measured but takes no share", () => {
    const off = simulate(groups(), 10, 1).churnCauses!;
    const load = off.causes.find((c) => c.id === "load")!;
    expect(load.enabled).toBe(false);
    expect(load.share).toBe(0);
    expect(load.pressure).toBeGreaterThan(0);
  });

  it("measures response time and rework where the model has ad-hoc requests and rework (Larkspur)", () => {
    const r = simulate(withDrivers(larkspurModel(), [{ id: "resp", weight: 1, enabled: true }, { id: "rework", weight: 1, enabled: true }]), 10, 1).churnCauses!;
    const resp = r.causes.find((c) => c.id === "resp")!;
    const rework = r.causes.find((c) => c.id === "rework")!;
    expect(resp.value).toBeGreaterThan(0);
    expect(rework.value).toBeGreaterThan(0);
    expect(resp.share + rework.share).toBeGreaterThan(0);
  });

  it("the market's value is its average factor", () => {
    const down = simulate(withMarketCondition(groups(), MARKET_PRESETS.downturn.factors), 5, 1).churnCauses!;
    expect(down.causes.find((c) => c.id === "market")!.value).toBeCloseTo(1.35, 10);
    expect(down.marketFactor).toBeCloseTo(1.35, 10);
    expect(down.causes.find((c) => c.id === "market")!.share).toBeGreaterThan(0);
  });
});

describe("the screen's projection", () => {
  const causes = simulate(northbeamWithChurnDrivers(), 30, 1).churnCauses!;
  const asRun = causes.causes.map((c) => ({ id: c.id, weight: c.weight, enabled: c.enabled }));

  it("reproduces each driver's share of the run at the weights the run used", () => {
    const p = projectChurn(causes, asRun);
    for (const c of causes.causes) expect(p.shares[c.id]).toBeCloseTo(c.share, 1);
    expect(p.normalShare + Object.values(p.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("moves with the weights: ignoring everything leaves normal churn alone", () => {
    const none = projectChurn(causes, asRun.map((c) => ({ ...c, enabled: false })));
    expect(none.clientsPerMonth).toBeCloseTo(causes.baseClientsPerMonth, 10);
    expect(none.normalShare).toBe(1);
    const more = projectChurn(causes, asRun.map((c) => (c.id === "late" ? { ...c, weight: 3 } : c)));
    expect(more.clientsPerMonth).toBeGreaterThan(projectChurn(causes, asRun).clientsPerMonth);
  });
});

describe("rule 10: cause of clients leaving", () => {
  const model = groups();
  const result = simulate(model, 30, 1);
  const issues = (config = {}, m = model, r = result) => churnCauseIssues(m, r, config);

  it("rates a driver that causes 30% or more of a group's churn Bad, and Operational risk when the group is under 50", () => {
    const found = issues();
    const ppc = found.find((i) => i.key === "churn_risk:driver:ppc:late")!;
    expect(ppc.metrics.share).toBeGreaterThanOrEqual(0.3);
    const health = ppc.metrics.group_health!;
    expect(ppc.rating).toBe(health < 50 ? "risk" : "bad");
    // SEO's late work is under 30% of its churn: nothing to report.
    expect(found.some((i) => i.key === "churn_risk:driver:seo:late")).toBe(false);
    expect(ppc.title).toBe(`Late or missed servicing work causes ${Math.round(ppc.metrics.share! * 100)}% of PPC management clients leaving`);
  });

  it("uses the rule's cut-offs from the settings: a higher share bar, a higher health bar", () => {
    const rating = (inputs: number[]) =>
      toRatingConfig({ rules: { driver: { inputs } } }, model.hoursPerWeek);
    expect(issues(rating([0.9, 50]))).toHaveLength(0);
    const risky = issues(rating([0.3, 100])).find((i) => i.key === "churn_risk:driver:ppc:late")!;
    expect(risky.rating).toBe("risk");
    const calm = issues(rating([0.3, 0])).find((i) => i.key === "churn_risk:driver:ppc:late")!;
    expect(calm.rating).toBe("bad");
  });

  it("is switched off with the rule, and detectIssues carries it", () => {
    expect(issues(toRatingConfig({ rules: { driver: { enabled: false } } }, model.hoursPerWeek))).toHaveLength(0);
    expect(detectIssues(model, result).some((i) => i.key.startsWith("churn_risk:driver:"))).toBe(true);
    expect(detectIssues(model, result, toRatingConfig({ rules: { driver: { enabled: false } } }, model.hoursPerWeek)).some((i) => i.key.startsWith("churn_risk:driver:"))).toBe(false);
  });

  it("ignores a driver that is switched off", () => {
    const m = withDrivers(model, [{ id: "late", weight: 1, enabled: false }]);
    expect(issues({}, m, simulate(m, 10, 1)).some((i) => i.key.endsWith(":late"))).toBe(false);
  });

  it("raises nothing for a run with no client accounting (the pooled model)", () => {
    const pooled: EngineModel = { ...northbeamWithServicing(), clients: undefined, servicingProcesses: undefined, services: undefined };
    expect(issues({}, pooled, simulate(pooled, 3, 1))).toEqual([]);
  });
});
