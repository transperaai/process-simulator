import { describe, expect, it } from "vitest";
import { partOf, toEngineModel } from "@transpera-flow/db";
import { simulate, type DetectedIssue } from "@transpera-flow/engine";
import { companyMap } from "@/lib/overview/company-map";
import { sortFindings, ratingCounts } from "@/lib/overview/findings";
import { headlineCards } from "@/lib/overview/headline";
import { checkpointMonths, checkpointWeeks, mrrAfter, percentile, startingMrr, summarise } from "@/lib/overview/projection";
import { demoBundle } from "@/lib/sources/demo";

const finding = (key: string, rating: DetectedIssue["rating"], cost?: number) =>
  ({ key, rating, ...(cost === undefined ? {} : { cost: { perMonth: cost } }) }) as unknown as DetectedIssue;

describe("findings", () => {
  it("sorts worst rating first, then dearest, then as found", () => {
    const sorted = sortFindings([finding("a", "bad", 10), finding("b", "risk"), finding("c", "bad", 500), finding("d", "risk", 5), finding("e", "bad")]);
    expect(sorted.map((f) => f.key)).toEqual(["d", "b", "c", "a", "e"]);
  });
  it("counts per rating", () => {
    const counts = ratingCounts([finding("a", "bad"), finding("b", "bad"), finding("c", "risk")]);
    expect(counts.find((c) => c.rating === "bad")?.count).toBe(2);
    expect(counts.find((c) => c.rating === "risk")?.count).toBe(1);
  });
});

describe("projection", () => {
  it("samples a horizon in a handful of runs, ending at the horizon", () => {
    for (const m of [1, 3, 6, 12, 24]) {
      const months = checkpointMonths(m);
      expect(months.at(-1)).toBeCloseTo(m);
      expect(months.length).toBeLessThanOrEqual(6);
    }
    expect(checkpointWeeks([1, 3])).toEqual([4, 13]);
  });
  it("interpolates percentiles", () => expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3));
  it("projects MRR from today's clients, wins and churn, with a range", () => {
    const model = toEngineModel(demoBundle());
    const start = startingMrr(model);
    expect(start.mrr).toBeGreaterThan(0);
    const result = simulate(model, 10, 1);
    const band = mrrAfter(model, summarise(model, result), start);
    expect(band.lo).toBeLessThanOrEqual(band.mean);
    expect(band.mean).toBeLessThanOrEqual(band.hi);
    const cards = headlineCards({ model, result, mrr: band, start, months: 3, currency: "GBP" });
    expect(cards.map((c) => c.key)).toEqual(["won", "mrr", "churn", "bottleneck"]);
    for (const c of cards) {
      expect(c.range).not.toBe("");
      expect(c.help.example).not.toBe("");
    }
  });
});

describe("company map", () => {
  const live = demoBundle();
  const parts = [partOf(live), ...(live.otherProcesses ?? [])];
  it("draws each process as a card holding its steps, and every step stays on the map", () => {
    const map = companyMap(live, parts);
    const top = map.bundle.steps.filter((s) => !s.parent_step_id);
    expect(top.map((s) => s.id).sort()).toEqual(parts.map((p) => p.process.id).sort());
    const working = parts.flatMap((p) => p.steps).filter((s) => s.kind !== "start" && s.kind !== "end");
    for (const s of working) expect(map.bundle.steps.some((x) => x.id === s.id || x.id === s.child_process_id)).toBe(true);
    expect(map.processOfStep.get(working[0]!.id)).toBe(working[0]!.process_id);
  });
  it("moves neighbours out of the way when a card opens", () => {
    const closed = companyMap(live, parts).bundle.steps.filter((s) => !s.parent_step_id);
    const first = parts[0]!.process.id;
    const open = companyMap(live, parts, new Set([first])).bundle.steps.filter((s) => !s.parent_step_id);
    const x = (list: typeof closed, id: string) => Number(list.find((s) => s.id === id)!.x);
    const others = parts.slice(1).map((p) => p.process.id);
    expect(others.some((id) => x(open, id) > x(closed, id))).toBe(true);
  });
});
