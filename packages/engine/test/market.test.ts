import { describe, expect, it } from "vitest";
import {
  MARKET_PRESETS,
  STABLE_MARKET,
  checkMarket,
  factorsFromPercents,
  marketAt,
  marketFromSchedule,
  northbeamWithServicing,
  percentsFromFactors,
  simulate,
  withMarketCondition,
  withMarketSchedule,
  type EngineModel,
  type MarketFactors,
} from "../src";

// Market conditions (decision D29, ticket A57): seven factors per month,
// applied by the engine month by month. Stable everywhere changes nothing.

const f = (over: Partial<MarketFactors>): MarketFactors => ({ ...STABLE_MARKET, ...over });

/** One step, one hour a week, a coin-flip between won and lost, and a retainer of 1000 a month. */
function funnel(overrides: Partial<EngineModel> = {}): EngineModel {
  return {
    horizonWeeks: 52,
    hoursPerWeek: 40,
    leadsPerWeek: 10,
    activeClients: 20,
    churnMonthly: 0.05,
    retainer: 1000,
    roles: {},
    warmupWeeks: 0,
    entry: "in",
    sinks: { won: "won", lost: "lost" },
    steps: [
      {
        id: "in",
        name: "In",
        role: null,
        work: 0,
        wait: 8,
        rework: 0,
        next: [
          { to: "won", p: 0.4 },
          { to: "lost", p: 0.6 },
        ],
      },
    ],
    ...overrides,
  };
}

const run = (m: EngineModel) => simulate(m, 10, 3);

describe("market conditions", () => {
  it("Stable everywhere, or no market, simulates exactly as before", () => {
    const base = northbeamWithServicing();
    const a = simulate(base, 4, 1);
    const stable = simulate(withMarketCondition(base, STABLE_MARKET), 4, 1);
    const sched = simulate(withMarketSchedule(base, marketFromSchedule([], () => STABLE_MARKET)), 4, 1);
    expect(JSON.stringify({ ...stable, engineVersion: 0 })).toBe(JSON.stringify({ ...a, engineVersion: 0 }));
    expect(JSON.stringify({ ...sched, engineVersion: 0 })).toBe(JSON.stringify({ ...a, engineVersion: 0 }));
  });

  it("the presets match the prototype and round-trip through whole percents", () => {
    expect(percentsFromFactors(MARKET_PRESETS.downturn.factors)).toEqual({
      leads: 65,
      conv: 75,
      cycle: 140,
      price: 88,
      churn: 135,
      hire: 80,
      pay: 135,
    });
    expect(factorsFromPercents(percentsFromFactors(MARKET_PRESETS.boom.factors))).toEqual(MARKET_PRESETS.boom.factors);
  });

  it("enquiries scale the arrival rate", () => {
    const base = run(funnel());
    const boom = run(withMarketCondition(funnel(), f({ leads: 1.5 })));
    const down = run(withMarketCondition(funnel(), f({ leads: 0.5 })));
    expect(boom.won / base.won).toBeGreaterThan(1.3);
    expect(down.won / base.won).toBeLessThan(0.7);
  });

  it("applies each month's factors as the run goes", () => {
    // Enquiries stop after month 6: nothing arrives in the last half year.
    const months = Array.from({ length: 24 }, (_, i) => f({ leads: i < 6 ? 1 : 0 }));
    const model = funnel({ horizonWeeks: 52 });
    const cut = run(withMarketSchedule(model, { months }));
    const half = run(withMarketCondition(model, f({ leads: 1 })));
    expect(cut.won).toBeLessThan(half.won * 0.6);
    expect(cut.won).toBeGreaterThan(half.won * 0.35);
    expect(marketAt(withMarketSchedule(model, { months }), 40 * 4.33 * 7).leads).toBe(0);
    expect(marketAt(withMarketSchedule(model, { months }), 40).leads).toBe(1);
  });

  it("enquiries that sign scale the won share without moving the rest", () => {
    const base = run(funnel());
    const soft = run(withMarketCondition(funnel(), f({ conv: 0.5 })));
    expect(soft.won / base.won).toBeGreaterThan(0.4);
    expect(soft.won / base.won).toBeLessThan(0.6);
    expect(soft.lost).toBeGreaterThan(base.lost);
  });

  it("prices scale new MRR", () => {
    const base = run(funnel());
    const cheap = run(withMarketCondition(funnel(), f({ price: 0.8 })));
    expect(cheap.won).toBe(base.won);
    expect(cheap.mrrAdded).toBeCloseTo(base.mrrAdded * 0.8, 6);
  });

  it("time to decide stretches external waits", () => {
    const base = run(funnel());
    const slow = run(withMarketCondition(funnel(), f({ cycle: 2 })));
    expect(slow.kpi.cycle.mean).toBeGreaterThan(base.kpi.cycle.mean);
  });

  it("clients leaving scales churn", () => {
    const model = funnel();
    const base = run(model);
    const lots = run(withMarketCondition(model, f({ churn: 3 })));
    expect(lots.kpi.billed.mean).toBeLessThan(base.kpi.billed.mean);
  });

  it("rejects factors out of range", () => {
    expect(() => checkMarket({ months: [f({ leads: -1 })] })).toThrow();
    expect(() => checkMarket({ months: [] })).toThrow();
    expect(() => simulate(withMarketCondition(funnel(), f({ conv: Number.NaN })), 1, 1)).toThrow();
  });

  it("expands a schedule into 24 months, Stable where nothing is set", () => {
    const m = marketFromSchedule(
      [
        { from: 7, to: 14, condition: "soft" },
        { from: 15, to: 24, condition: "mine" },
      ],
      (id) => (id === "soft" ? MARKET_PRESETS.soft.factors : id === "mine" ? f({ leads: 0.9 }) : undefined),
    );
    expect(m.months).toHaveLength(24);
    expect(m.months[0]).toEqual(STABLE_MARKET);
    expect(m.months[6]).toEqual(MARKET_PRESETS.soft.factors);
    expect(m.months[23]!.leads).toBe(0.9);
  });
});
