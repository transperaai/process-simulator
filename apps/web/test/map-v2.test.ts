import { describe, expect, it } from "vitest";
import { northbeamBundle, northbeamIssues, northbeamStepIds, toEngineModel } from "@transpera-flow/db";
import { detectIssues, simulate } from "@transpera-flow/engine";
import { confirmedBadges, entryView, registerEntries, stepBadges } from "@/lib/issues/register";
import { DEMO_GROUP_IDS, withDemoGroups } from "@/lib/demo/nested";
import { demoBundle } from "@/lib/sources/demo";
import { groupsToOpen, litIds, withHighlightOpen } from "@/lib/map/highlight";
import { LEGEND_ORDER, RATING_STYLE, ratingOfRank } from "@/lib/map/rating";
import { MAX_FIT_ZOOM, MAX_ZOOM, MIN_FIT_ZOOM, MIN_ZOOM, fitViewport, fitZoom, stepZoom } from "@/lib/map/zoom";

// Map v2 (issue #99): the fit calculation, the red badges, highlighting and the rating colours.

describe("fitting the map to its panel", () => {
  it("fits a small map to the panel, and never blows it up past 115%", () => {
    expect(fitZoom({ width: 800, height: 400 }, { width: 1000, height: 600 })).toBeCloseTo(1.15);
    expect(fitZoom({ width: 1000, height: 500 }, { width: 900, height: 700 })).toBeCloseTo(0.9);
  });

  it("never shrinks a big map below 70%: it scrolls instead", () => {
    expect(fitZoom({ width: 4000, height: 900 }, { width: 800, height: 600 })).toBe(MIN_FIT_ZOOM);
    expect(fitZoom({ width: 900, height: 5000 }, { width: 900, height: 600 })).toBe(MIN_FIT_ZOOM);
    expect(MIN_FIT_ZOOM).toBe(0.7);
    expect(MAX_FIT_ZOOM).toBeGreaterThan(1);
  });

  it("falls back to 100% without a size to fit", () => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1);
    expect(fitZoom({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
  });

  it("centres a map that fits and pins one that does not to the top left", () => {
    const small = fitViewport({ x: 0, y: 0, width: 400, height: 200 }, { width: 1000, height: 600 });
    expect(small.zoom).toBeCloseTo(1.15);
    expect(small.x).toBeCloseTo((1000 - 400 * small.zoom) / 2);
    expect(small.y).toBeCloseTo((600 - 200 * small.zoom) / 2);
    const big = fitViewport({ x: 100, y: 50, width: 3000, height: 800 }, { width: 800, height: 600 }, { top: 56, right: 24, bottom: 24, left: 24 });
    expect(big.zoom).toBe(0.7);
    // The top left of the content sits just inside the panel's padding.
    expect(big.x + 100 * big.zoom).toBeCloseTo(24);
    expect(big.y + 50 * big.zoom).toBeCloseTo(56);
  });

  it("steps the zoom by buttons and stops at the ends", () => {
    expect(stepZoom(1, "in")).toBe(1.15);
    expect(stepZoom(1, "out")).toBe(0.85);
    expect(stepZoom(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
  });
});

/** What the latest run detects: the single points of failure, two of them (Audit is tracked already; Kickoff is not). */
function northbeamDetections() {
  const b = northbeamBundle();
  const model = toEngineModel({ ...b, clients: [], clientServices: [], clientAssignments: [] }, "2026-10-05");
  return detectIssues(model, simulate(model, 30, 1)).filter((d) => d.key.startsWith("spof:"));
}

describe("red badges count confirmed issues only", () => {
  const entries = registerEntries(northbeamIssues(), northbeamDetections());

  it("leaves out what a run only detected, which still colours the step", () => {
    const detected = entries.filter((e) => e.kind === "detected");
    expect(detected.length).toBeGreaterThan(0);
    const confirmed = confirmedBadges(entries);
    const all = stepBadges(entries);
    const total = (b: typeof all) => Object.values(b).reduce((n, x) => n + x.count, 0);
    const openDetected = detected.filter((e) => entryView(e).open && entryView(e).stepId).length;
    expect(openDetected).toBeGreaterThan(0);
    expect(total(all) - total(confirmed)).toBe(openDetected);
    // The step with only a detection has no badge, but has a rating.
    const onlyDetected = detected.map((e) => entryView(e).stepId!).filter((id) => !confirmed[id]);
    expect(onlyDetected.length).toBeGreaterThan(0);
    for (const id of onlyDetected) expect(all[id]).toBeDefined();
  });

  it("counts tracked, open issues, and not closed ones", () => {
    const [first] = northbeamIssues();
    const closed = registerEntries([{ ...first!, status: "dismissed" }], []);
    expect(confirmedBadges(closed)).toEqual({});
    expect(Object.keys(confirmedBadges(entries)).length).toBeGreaterThan(0);
  });
});

describe("highlighting steps on the map", () => {
  const b = withDemoGroups(demoBundle());
  const ids = northbeamStepIds;
  const none = new Set<string>();

  it("opens the groups a highlighted step is in, and leaves the open state alone otherwise", () => {
    expect(groupsToOpen(b.steps, [ids.qualify])).toEqual([DEMO_GROUP_IDS.conversation]);
    expect(groupsToOpen(b.steps, [ids.start])).toEqual([]);
    const opened = withHighlightOpen(b.steps, none, [ids.qualify]);
    expect([...opened]).toEqual([DEMO_GROUP_IDS.conversation]);
    expect(withHighlightOpen(b.steps, none, null)).toBe(none);
    expect(withHighlightOpen(b.steps, none, [])).toBe(none);
    const already = new Set([DEMO_GROUP_IDS.conversation]);
    expect(withHighlightOpen(b.steps, already, [ids.qualify])).toBe(already);
  });

  it("lights the step itself once its group is open, and the closed group while it is not", () => {
    expect([...litIds(b.steps, new Set([DEMO_GROUP_IDS.conversation]), [ids.qualify])]).toEqual([ids.qualify]);
    expect([...litIds(b.steps, none, [ids.qualify])]).toEqual([DEMO_GROUP_IDS.conversation]);
    expect(litIds(b.steps, none, ["not-a-step"]).size).toBe(0);
    expect(litIds(b.steps, none, null).size).toBe(0);
  });
});

describe("rating colours", () => {
  it("has a colour from the tokens for each of the four ratings, lime for Good", () => {
    expect(LEGEND_ORDER).toEqual(["risk", "bad", "good", "great"]);
    for (const r of LEGEND_ORDER) {
      expect(RATING_STYLE[r].stripe).toMatch(/^var\(--rate-/);
      expect(RATING_STYLE[r].soft).toMatch(/^var\(--rate-.*-soft\)$/);
    }
    expect(RATING_STYLE.good.stripe).toBe("var(--rate-good)");
  });

  it("turns a rank back into its rating", () => {
    expect([0, 1, 2, 3].map(ratingOfRank)).toEqual(["great", "good", "bad", "risk"]);
    expect(ratingOfRank(-1)).toBeNull();
    expect(ratingOfRank(4)).toBeNull();
  });
});
