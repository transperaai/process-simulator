import { describe, expect, it } from "vitest";
import { northbeamModel, simulate } from "../src";

describe("simulate (Northbeam)", () => {
  it("is deterministic for a given seed", () => {
    const a = simulate(northbeamModel(), 30, 1);
    const b = simulate(northbeamModel(), 30, 1);
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    expect(simulate(northbeamModel(), 30, 1).won).not.toBe(simulate(northbeamModel(), 30, 2).won);
  });

  it("starts after an automatic warm-up sized from a pilot run", () => {
    const res = simulate(northbeamModel(), 5, 1);
    expect(res.initialState.kind).toBe("warmup");
    // 2x the pilot's P90 cycle time (~8 weeks) beats the 4-week minimum.
    expect(res.initialState.kind === "warmup" && res.initialState.hours).toBeGreaterThan(4 * 40);
  });

  it("finds the strategist as the bottleneck role", () => {
    const res = simulate(northbeamModel(), 30, 1);
    expect(res.bnRole).toBe("strat");
    expect(res.roles.strat!.util).toBeGreaterThan(0.75);
  });

  // The golden model must be in steady state, or its KPIs measure the warm-up
  // rather than the business (at the prototype's 12 leads/week, wins moved
  // from 7.4 to 11.2 a quarter with warm-up length).
  it("reaches a steady state, so KPIs do not depend on warm-up length", () => {
    const auto = simulate(northbeamModel(), 200, 1);
    const long = simulate({ ...northbeamModel(), warmupWeeks: 32 }, 200, 1);
    expect(auto.roles.strat!.util).toBeLessThan(0.9);
    expect(Math.abs(auto.won - long.won) / long.won).toBeLessThan(0.05);
    expect(Math.abs(auto.cycleP90 - long.cycleP90) / long.cycleP90).toBeLessThan(0.05);
  });

  it("produces a plausible quarter of wins with an ordered range", () => {
    const res = simulate(northbeamModel(), 30, 1);
    expect(res.won).toBeGreaterThan(3);
    expect(res.won).toBeLessThan(15);
    expect(res.wonLow).toBeLessThanOrEqual(res.won);
    expect(res.wonHigh).toBeGreaterThanOrEqual(res.won);
    expect(res.cycleP50).toBeLessThanOrEqual(res.cycleP90);
  });

  it("keeps a trace only for replication 0", () => {
    const res = simulate(northbeamModel(), 5, 1);
    expect(res.trace).not.toBeNull();
    expect(res.trace!.length).toBeGreaterThan(0);
    expect(res.trace!.every((e) => e.trace.every((s) => s.tQ <= (s.tS ?? Infinity)))).toBe(true);
  });

  it("raises bottleneck utilisation when leads double", () => {
    const base = simulate(northbeamModel(), 30, 1);
    const doubled = simulate({ ...northbeamModel(), leadsPerWeek: 2 * northbeamModel().leadsPerWeek }, 30, 1);
    expect(doubled.roles.strat!.util).toBeGreaterThan(base.roles.strat!.util);
  });
});
