import { describe, expect, it } from "vitest";
import type { MarketConditionRow, MarketScheduleRow } from "@transpera-flow/db";
import { MARKET_FACTOR_KEYS } from "@transpera-flow/engine";
import {
  CONDITION_HELP,
  FACTORS,
  SCHEDULE_HELP,
  conditionTone,
  copyName,
  helpFor,
  monthRange,
  orderConditions,
  parseChange,
  parseConditionField,
  segments,
  timeline,
} from "@/lib/market";

// Wording, checks and the timeline behind Settings → Market conditions (A57).

const ws = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cond = (n: number, name: string, preset: MarketConditionRow["preset"] = null): MarketConditionRow => ({
  id: id(n),
  workspace_id: ws,
  name,
  preset,
  leads: 100,
  conv: 100,
  cycle: 100,
  price: 100,
  churn: 100,
  hire: 100,
  pay: 100,
});
const change = (n: number, from: number, to: number, c: number): MarketScheduleRow => ({ id: id(100 + n), workspace_id: ws, from_month: from, to_month: to, condition_id: id(c) });

describe("help wording", () => {
  it("every factor has a plain description and an example, in the engine's order", () => {
    expect(FACTORS.map((f) => f.key)).toEqual([...MARKET_FACTOR_KEYS]);
    for (const f of FACTORS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(10);
      expect(f.example.length).toBeGreaterThan(5);
    }
  });
  it("every preset, custom conditions and the schedule have one too", () => {
    for (const k of ["boom", "stable", "soft", "downturn", "custom"]) expect(CONDITION_HELP[k]!.example.length).toBeGreaterThan(5);
    expect(SCHEDULE_HELP.description.length).toBeGreaterThan(10);
    expect(helpFor({ preset: null })).toBe(CONDITION_HELP.custom);
    expect(helpFor({ preset: "soft" })).toBe(CONDITION_HELP.soft);
  });
});

describe("orderConditions and tone", () => {
  it("lists the presets first in the prototype's order, then your own by name", () => {
    const all = [cond(1, "Zed"), cond(2, "Downturn", "downturn"), cond(3, "Boom", "boom"), cond(4, "Alpha"), cond(5, "Soft", "soft"), cond(6, "Stable", "stable")];
    expect(orderConditions(all).map((c) => c.name)).toEqual(["Boom", "Stable", "Soft", "Downturn", "Alpha", "Zed"]);
  });
  it("colours presets by climate and your own with the brand tint", () => {
    expect(conditionTone(cond(1, "x", "boom"))).toBe("good");
    expect(conditionTone(cond(1, "x", "downturn"))).toBe("crit");
    expect(conditionTone(cond(1, "x"))).toBe("own");
    expect(conditionTone(undefined)).toBe("own");
  });
  it("names copies the way the prototype does", () => {
    expect(copyName({ name: "Soft" })).toBe("Soft (custom)");
    expect(copyName(undefined)).toBe("New market");
    expect(copyName({ name: "x".repeat(80) })).toHaveLength(80);
  });
});

describe("timeline", () => {
  const schedule = [change(1, 7, 14, 2), change(2, 15, 24, 3)];
  it("covers 24 months, empty (Stable) where no change applies", () => {
    const t = timeline(schedule);
    expect(t).toHaveLength(24);
    expect(t[0]).toEqual({ month: 1, conditionId: null, starts: false });
    expect(t[6]).toEqual({ month: 7, conditionId: id(2), starts: true });
    expect(t[7]!.starts).toBe(false);
    expect(t[23]!.conditionId).toBe(id(3));
  });
  it("draws one block per run of months", () => {
    expect(segments(schedule)).toEqual([
      { from: 1, to: 6, conditionId: null },
      { from: 7, to: 14, conditionId: id(2) },
      { from: 15, to: 24, conditionId: id(3) },
    ]);
    expect(segments([])).toEqual([{ from: 1, to: 24, conditionId: null }]);
  });
  it("keeps two back-to-back changes of the same condition apart", () => {
    expect(segments([change(1, 1, 3, 2), change(2, 4, 6, 2)]).map((s) => [s.from, s.to])).toEqual([
      [1, 3],
      [4, 6],
      [7, 24],
    ]);
  });
  it("writes ranges", () => {
    expect(monthRange(7, 14)).toBe("M7–M14");
    expect(monthRange(3, 3)).toBe("M3");
  });
});

describe("parseConditionField", () => {
  it("accepts a trimmed name and whole-percent factors", () => {
    expect(parseConditionField(id(1), "name", "  Cautious 2027 ")).toEqual({ id: id(1), field: "name", value: "Cautious 2027" });
    expect(parseConditionField(id(1), "leads", 92)).toEqual({ id: id(1), field: "leads", value: 92 });
    expect(parseConditionField(id(1), "pay", 0)?.value).toBe(0);
    expect(parseConditionField(id(1), "churn", 500)?.value).toBe(500);
  });
  it.each([
    ["name", ""],
    ["name", "   "],
    ["name", "x".repeat(81)],
    ["name", 5],
    ["leads", -1],
    ["leads", 501],
    ["leads", 92.5],
    ["leads", "92"],
    ["preset", "boom"],
    ["workspace_id", id(2)],
  ])("rejects %s = %s", (field, value) => {
    expect(parseConditionField(id(1), field, value)).toBeNull();
  });
  it("rejects a bad id", () => expect(parseConditionField("nope", "leads", 90)).toBeNull());
});

describe("parseChange", () => {
  it("accepts months 1 to 24 in order", () => {
    expect(parseChange(ws, id(2), 7, 14)).toEqual({ workspaceId: ws, conditionId: id(2), from: 7, to: 14 });
    expect(parseChange(ws, id(2), 3, 3)).toMatchObject({ from: 3, to: 3 });
  });
  it.each([
    [0, 3],
    [1, 25],
    [1.5, 3],
    [Number.NaN, 3],
  ])("rejects months %s to %s", (from, to) => {
    expect(parseChange(ws, id(2), from, to)).toHaveProperty("error");
  });
  it("rejects a last month before the first, a missing market, and an overlap", () => {
    expect(parseChange(ws, id(2), 9, 8)).toHaveProperty("error");
    expect(parseChange(ws, "", 1, 3)).toHaveProperty("error");
    const clash = parseChange(ws, id(2), 10, 16, [{ from_month: 7, to_month: 14 }]);
    expect(clash).toHaveProperty("error");
    expect((clash as { error: string }).error).toContain("M7–M14");
    expect(parseChange(ws, id(2), 15, 16, [{ from_month: 7, to_month: 14 }])).not.toHaveProperty("error");
  });
});
