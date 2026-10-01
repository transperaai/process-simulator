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

const none = { added: [], removed: [], changed: [] };
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
  it("counts steps and connections in plain words", () => {
    expect(describeChanges(changes({ steps: { added: ["a"], removed: [], changed: ["b", "c"] }, edges: { added: [], removed: ["e"], changed: ["f"] } }), false)).toBe(
      "2 steps changed, 1 added; 1 connection changed, 1 removed",
    );
  });
  it("says so when a version changed nothing, and when changes weren't recorded", () => {
    expect(describeChanges(changes({}), false)).toBe("Nothing changed (published again as it was)");
    expect(describeChanges(null, false)).toBe("Changes weren't recorded");
    expect(describeChanges(null, true)).toBe("First version");
  });
});

describe("parseChanges", () => {
  it("reads the audit entry's changes and ignores anything else", () => {
    expect(parseChanges({ steps: { added: ["a"], removed: [], changed: [] }, edges: { added: [], removed: [], changed: ["x", 3] } })).toEqual({
      steps: { added: ["a"], removed: [], changed: [] },
      edges: { added: [], removed: [], changed: ["x"] },
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
    expect(byNumber[4]!.changes!.steps.changed).toHaveLength(3);
    expect(describeChanges(byNumber[4]!.changes, false)).toBe("3 steps changed");
  });
  it("knows its servicing processes too, and nothing else", () => {
    for (const id of Object.values(northbeamServicingProcessIds)) expect(demoHistory(id)).not.toBeNull();
    expect(demoHistory("not-a-process")).toBeNull();
  });

  it("simulates with the same seed to the same numbers, and the older, slower versions win less and take longer", () => {
    const headline = (n: number) => {
      const v = history.versions.find((x) => x.number === n)!;
      const m = (history.models[v.revisionId] as { model: Parameters<typeof simulate>[0] }).model;
      return headlineOf(simulate(m, HISTORY_REPS, HISTORY_SEED), m);
    };
    expect(headline(2)).toEqual(headline(2));
    const [old, current] = [headline(1), headline(4)];
    expect(old.leadToWinDays.mean).toBeGreaterThan(current.leadToWinDays.mean);
    expect(old.winsPerMonth.mean).toBeLessThanOrEqual(current.winsPerMonth.mean);
    for (const h of [old, current]) {
      expect(h.winsPerMonth.lo).toBeLessThanOrEqual(h.winsPerMonth.mean);
      expect(h.winsPerMonth.hi).toBeGreaterThanOrEqual(h.winsPerMonth.mean);
      expect(h.leadToWinDays.lo).toBeLessThanOrEqual(h.leadToWinDays.mean);
      expect(h.leadToWinDays.hi).toBeGreaterThanOrEqual(h.leadToWinDays.mean);
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
    expect(h.winsPerMonth.mean).toBeCloseTo(13 / 3, 5);
    expect(h.winsPerMonth.lo).toBeCloseTo(10 / 3, 5);
    expect(h.winsPerMonth.hi).toBeCloseTo(16 / 3, 5);
    // An 8-hour day: 80 hours is 10 days; the band runs from the typical (60 h) to the slow (160 h) case.
    expect(h.leadToWinDays).toEqual({ mean: 10, lo: 7.5, hi: 20 });
    expect(headlineOf(result, { horizonWeeks: 26, hoursPerWeek: 40 }).winsPerMonth.mean).toBeCloseTo(13 / 6, 5);
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

  it("rounds the axis top to a tidy number", () => {
    expect([niceMax(0.3), niceMax(4.2), niceMax(7), niceMax(23), niceMax(0)]).toEqual([0.5, 5, 10, 25, 1]);
  });
});
