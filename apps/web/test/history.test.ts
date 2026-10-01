import { describe, expect, it } from "vitest";
import { simulate } from "@transpera-flow/engine";
import { chartGeometry, niceMax } from "@/lib/history/chart";
import { demoHistory } from "@/lib/history/demo";
import {
  AUTO_RUN_VERSIONS,
  HISTORY_REPS,
  HISTORY_SEED,
  authorLabel,
  autoRunIds,
  describeChanges,
  formatPublished,
  headlineOf,
  parseChanges,
  type RevisionChanges,
} from "@/lib/history/versions";
import { NORTHBEAM_PROCESS_ID, northbeamServicingProcessIds } from "@transpera-flow/db";

// Process history (issue #105): who published, what changed, the headline numbers, the charts' geometry and the
// demo's versions.

const none = { added: 0, removed: 0, changed: 0 };
const changes = (c: Partial<RevisionChanges>): RevisionChanges => ({ steps: none, edges: none, ...c });

describe("authorLabel", () => {
  it("says Claude (MCP) for a publish through MCP, whatever the token's owner is called", () => {
    expect(authorLabel({ authorKind: "mcp", authorName: "Priya Shah" })).toBe("Claude (MCP)");
  });
  it("names the person, or a team member when the workspace has no name for them", () => {
    expect(authorLabel({ authorKind: "user", authorName: "Priya Shah" })).toBe("Priya Shah");
    expect(authorLabel({ authorKind: "user", authorName: null })).toBe("A team member");
  });
  it("calls a version nobody recorded as imported", () => {
    expect(authorLabel({ authorKind: null, authorName: null })).toBe("Imported");
    expect(authorLabel({ authorKind: "system", authorName: null })).toBe("System");
  });
});

describe("describeChanges", () => {
  it("counts steps and connections in plain words, with the noun on every part", () => {
    expect(describeChanges(changes({ steps: { added: 1, removed: 0, changed: 2 }, edges: { added: 3, removed: 1, changed: 1 } }), false)).toBe(
      "2 steps changed, 1 step added, 1 connection changed, 3 connections added, 1 connection removed",
    );
    expect(describeChanges(changes({ steps: { added: 3, removed: 0, changed: 0 }, edges: { added: 0, removed: 1, changed: 0 } }), false)).toBe("3 steps added, 1 connection removed");
  });
  it("says only 'First version' for the oldest version, whatever its counts (everything in it is new)", () => {
    expect(describeChanges(changes({ steps: { added: 7, removed: 0, changed: 0 }, edges: { added: 7, removed: 0, changed: 0 } }), true)).toBe("First version");
    expect(describeChanges(null, true)).toBe("First version");
  });
  it("says so when a version changed nothing, and when changes weren't recorded", () => {
    expect(describeChanges(changes({}), false)).toBe("Nothing changed (published again as it was)");
    expect(describeChanges(null, false)).toBe("Changes weren't recorded");
  });
});

describe("parseChanges", () => {
  it("reads the counts and ignores anything else", () => {
    expect(parseChanges({ steps: { added: 1, removed: 0, changed: 2 }, edges: { added: "x", removed: -1, changed: 4.7 } })).toEqual({
      steps: { added: 1, removed: 0, changed: 2 },
      edges: { added: 0, removed: 0, changed: 4 },
    });
    expect(parseChanges(null)).toBeNull();
    expect(parseChanges({})).toEqual({ steps: none, edges: none });
  });
});

describe("formatPublished", () => {
  it("prints the UTC day", () => {
    expect(formatPublished("2026-09-29T23:30:00Z")).toBe("29 Sep 2026");
    expect(formatPublished(null)).toBe("–");
  });
});

describe("autoRunIds", () => {
  const versions = Array.from({ length: 14 }, (_, i) => ({ revisionId: `r${i + 1}`, number: i + 1 }));
  it("is the newest ten, newest first, whatever order they come in", () => {
    const ids = autoRunIds([...versions].reverse());
    expect(ids).toHaveLength(AUTO_RUN_VERSIONS);
    expect(ids[0]).toBe("r14");
    expect(ids.at(-1)).toBe("r5");
  });
  it("takes fewer when there are fewer", () => expect(autoRunIds(versions.slice(0, 3))).toEqual(["r3", "r2", "r1"]));
});

describe("demo history", () => {
  const history = demoHistory(NORTHBEAM_PROCESS_ID)!;

  it("has four versions, newest first, the newest live, each with a model", () => {
    expect(history.versions.map((v) => [v.number, v.live])).toEqual([
      [4, true],
      [3, false],
      [2, false],
      [1, false],
    ]);
    expect(history.versions.every((v) => "model" in history.models[v.revisionId]!)).toBe(true);
    expect(history.versions.map((v) => authorLabel(v))).toEqual(["Priya Shah", "Claude (MCP)", "Maya Collins", "Priya Shah"]);
  });
  it("works out each version's changes from its steps; the first has none to compare", () => {
    const byNumber = Object.fromEntries(history.versions.map((v) => [v.number, v]));
    expect(byNumber[1]!.changes).toBeNull();
    expect(byNumber[4]!.changes!.steps.changed).toBe(3);
    expect(describeChanges(byNumber[4]!.changes, false)).toBe("3 steps changed");
  });
  it("knows its servicing processes too, and nothing else", () => {
    for (const id of Object.values(northbeamServicingProcessIds)) expect(demoHistory(id)).not.toBeNull();
    expect(demoHistory("not-a-process")).toBeNull();
  });

  it("simulates with the same seed to the same numbers, and the older, slower versions take longer from lead to win", () => {
    const headline = (n: number) => {
      const v = history.versions.find((x) => x.number === n)!;
      const m = (history.models[v.revisionId] as { model: Parameters<typeof simulate>[0] }).model;
      return headlineOf(simulate(m, HISTORY_REPS, HISTORY_SEED), m);
    };
    expect(headline(2)).toEqual(headline(2));
    expect(history.kind).toBe("pipeline");
    const [old, current] = [headline(1), headline(4)];
    expect(old.b!.mean).toBeGreaterThan(current.b!.mean);
    // Wins are limited by the leads that arrive, so they stay close; the cycle is what the older versions got wrong.
    expect(old.a!.mean).toBeGreaterThan(0);
    for (const h of [old, current]) {
      expect(h.a!.lo).toBeLessThanOrEqual(h.a!.mean);
      expect(h.a!.hi).toBeGreaterThanOrEqual(h.a!.mean);
      expect(h.b!.lo).toBeLessThanOrEqual(h.b!.mean);
      expect(h.b!.hi).toBeGreaterThanOrEqual(h.b!.mean);
    }
  });
});

describe("headlineOf", () => {
  it("turns a run over any horizon into wins per month, and hours into working days", () => {
    const result = {
      kpi: { won: { mean: 13, p10: 10, p90: 16 }, cycle: { mean: 80, p50: 60, p90: 160 } },
    } as unknown as Parameters<typeof headlineOf>[0];
    const h = headlineOf(result, { horizonWeeks: 13, hoursPerWeek: 40 });
    // 13 weeks is three months: a month is a third of it.
    expect(h.a!.mean).toBeCloseTo(13 / 3, 5);
    expect(h.a!.lo).toBeCloseTo(10 / 3, 5);
    expect(h.a!.hi).toBeCloseTo(16 / 3, 5);
    // An 8-hour day: 80 hours is 10 days; the band runs from the typical (60 h) to the slow (160 h) case.
    expect(h.b).toEqual({ mean: 10, lo: 7.5, hi: 20 });
    expect(headlineOf(result, { horizonWeeks: 26, hoursPerWeek: 40 }).a!.mean).toBeCloseTo(13 / 6, 5);
  });
});

describe("headlineOf for a servicing process", () => {
  const result = (t?: object) => ({ kpi: { won: { mean: 0, p10: 0, p90: 0 }, cycle: { mean: 0, p50: 0, p90: 0 }, touchpoints: t } }) as unknown as Parameters<typeof headlineOf>[0];
  const model = { horizonWeeks: 13, hoursPerWeek: 40 };
  const zero = { mean: 0, p10: 0, p90: 0 };
  it("is the share of touchpoints on time, and the share late or missed", () => {
    const h = headlineOf(result({ onTime: { mean: 90, p10: 80, p90: 95 }, late: { mean: 6, p10: 3, p90: 10 }, missed: { mean: 4, p10: 1, p90: 8 } }), model, "servicing");
    expect(h.a).toEqual({ mean: 90, lo: 80, hi: 95 });
    expect(h.b).toEqual({ mean: 10, lo: 5, hi: 20 });
  });
  it("has no numbers without a client roster", () => {
    expect(headlineOf(result(undefined), model, "servicing")).toEqual({ a: null, b: null });
    expect(headlineOf(result({ onTime: zero, late: zero, missed: zero }), model, "servicing")).toEqual({ a: null, b: null });
  });
  it("is measured on the demo's servicing processes", () => {
    const id = Object.values(northbeamServicingProcessIds)[0]!;
    const h = demoHistory(id)!;
    expect(h.kind).toBe("servicing");
    const m = (h.models[h.versions[0]!.revisionId] as { model: Parameters<typeof simulate>[0] }).model;
    const out = headlineOf(simulate(m, 5, HISTORY_SEED), m, "servicing");
    expect(out.a).not.toBeNull();
    expect(out.a!.mean + out.b!.mean).toBeCloseTo(100, 5);
  });
});

describe("chartGeometry", () => {
  const size = { width: 400, height: 200, pad: { top: 10, right: 10, bottom: 20, left: 30 } };
  const m = (mean: number, lo = mean - 1, hi = mean + 1) => ({ mean, lo, hi });

  it("plots the versions left to right, higher values higher up, and the band above and below the line", () => {
    const g = chartGeometry(
      [
        { label: "v1", measure: m(2) },
        { label: "v2", measure: m(4) },
        { label: "v3", measure: m(3) },
      ],
      size,
    );
    expect(g.points.map((p) => p.label)).toEqual(["v1", "v2", "v3"]);
    expect(g.points[0]!.x).toBe(30);
    expect(g.points[2]!.x).toBe(390);
    expect(g.points[1]!.yMean).toBeLessThan(g.points[0]!.yMean);
    expect(g.points.every((p) => p.yHi < p.yMean && p.yMean < p.yLo)).toBe(true);
    expect(g.lines).toHaveLength(1);
    expect(g.bands).toHaveLength(1);
    expect(g.bands[0]).toMatch(/Z$/);
    // The axis starts at zero and tops out above the highest range.
    expect(g.ticks[0]!.value).toBe(0);
    expect(g.max).toBeGreaterThanOrEqual(5);
  });

  it("leaves a gap for a version without numbers, instead of drawing a line through it", () => {
    const g = chartGeometry(
      [
        { label: "v1", measure: m(2) },
        { label: "v2", measure: null },
        { label: "v3", measure: m(3) },
        { label: "v4", measure: m(3.5) },
      ],
      size,
    );
    expect(g.points).toHaveLength(3);
    expect(g.lines).toHaveLength(1);
    // The lone v1 has no neighbour to join; v3 to v4 is a line. Every version still has its label.
    expect(g.labels.map((l) => l.label)).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("copes with nothing to draw, and with a single version", () => {
    const empty = chartGeometry([{ label: "v1", measure: null }], size);
    expect(empty.points).toEqual([]);
    expect(empty.lines).toEqual([]);
    expect(empty.max).toBeGreaterThan(0);
    const one = chartGeometry([{ label: "v1", measure: m(5) }], size);
    expect(one.points).toHaveLength(1);
    expect(one.points[0]!.x).toBe(210);
    expect(one.lines).toEqual([]);
  });

  it("pins the axis top when asked (100 for a percentage)", () => {
    expect(chartGeometry([{ label: "v1", measure: m(90, 80, 95) }], size, 100).max).toBe(100);
  });

  it("rounds the axis top to a tidy number", () => {
    expect([niceMax(0.3), niceMax(4.2), niceMax(7), niceMax(23), niceMax(0)]).toEqual([0.5, 5, 10, 25, 1]);
  });
});
