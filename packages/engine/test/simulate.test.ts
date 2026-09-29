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

  it("finds the strategist as the bottleneck role", () => {
    const res = simulate(northbeamModel(), 30, 1);
    expect(res.bnRole).toBe("strat");
    expect(res.roles.strat!.util).toBeGreaterThan(0.85);
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
    const doubled = simulate({ ...northbeamModel(), leadsPerWeek: 24 }, 30, 1);
    expect(doubled.roles.strat!.util).toBeGreaterThan(base.roles.strat!.util);
  });
});
