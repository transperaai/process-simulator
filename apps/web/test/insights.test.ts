import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noCost, type DetectedIssue, type Rating } from "@transpera-flow/engine";
import { confirmedBadges, confirmedRatings, registerEntries, stepBadges } from "@/lib/issues/register";
import { MemoryIssueStore } from "@/lib/issues/store";
import { acknowledgeInsight, dismissInsight } from "@/lib/insights/actions";
import { buildInsights, filterByRating, issueNumbers, ratingCountsOf, sourceOf, type Detection } from "@/lib/insights/insights";
import type { IssuesState } from "@/lib/issues/use-issues";

// Insights v2 (issue #110, A45).

// Ids as the database has them (uuids), and keys as the detectors write them.
const uuid = (n: string) => `00000000-0000-4000-8000-${n.charCodeAt(0).toString(16).padStart(12, "0")}`;
const P1 = uuid("p");
const det = (id: string, rating: Rating, perMonth: number | null, extra: Partial<Detection> = {}): Detection => ({
  key: `capacity:role:${id}`,
  type: "capacity",
  rating,
  escalation: { base: rating, raised: [] } as unknown as DetectedIssue["escalation"],
  cost: perMonth === null ? noCost("") : { ...noCost(""), perMonth },
  title: `Title ${id}`,
  evidence: `Busy ${id}. Second sentence.`,
  metrics: {},
  stepId: uuid(id),
  roleId: null,
  personId: null,
  fix: null,
  ...extra,
});

/** The issue state the hooks give, over the in-memory store. */
function state(store: MemoryIssueStore): Pick<IssuesState, "promote" | "saver"> & { rows: () => unknown[] } {
  const rows: unknown[] = [];
  return {
    rows: () => rows,
    promote: async (input) => {
      const r = await store.promote(input);
      return r.status === "ok" ? r.issue : null;
    },
    saver: (id, field) => (base, next) => store.saveField(id, field, base, next),
  };
}

const ctx = { processId: P1, scenarios: [] };

describe("insight rows", () => {
  const found = [det("a", "good", 900), det("b", "risk", null), det("c", "bad", 200), det("d", "bad", 700), det("e", "risk", 100)];

  it("lists worst rating first, then dearest, with unpriced last in its rating", () => {
    const list = buildInsights(registerEntries([], found), []);
    expect(list.map((i) => i.key)).toEqual(["e", "b", "d", "c", "a"].map((x) => `capacity:role:${x}`));
  });

  it("carries the number, the touched steps and where it came from", () => {
    const [i] = buildInsights(registerEntries([], [det("a", "bad", 5)]), []);
    expect(i!.number).toBe("Busy a.");
    expect(i!.found).toBe("Busy a. Second sentence.");
    expect(i!.why.length).toBeGreaterThan(10);
    expect(i!.stepIds).toEqual([uuid("a")]);
    expect(i!.source).toEqual({ kind: "rule", ruleId: "busy", name: "Too busy" });
  });

  it("supports AI as a source", () => {
    expect(sourceOf(det("a", "bad", 1, { origin: "ai" }))).toEqual({ kind: "ai", name: "AI" });
  });

  it("counts and filters by rating", () => {
    const list = buildInsights(registerEntries([], found), []);
    expect(ratingCountsOf(list)).toEqual([
      { rating: "risk", count: 2 },
      { rating: "bad", count: 2 },
      { rating: "good", count: 1 },
    ]);
    expect(filterByRating(list, "bad").map((i) => i.key)).toEqual(["d", "c"].map((x) => `capacity:role:${x}`));
    expect(filterByRating(list, "")).toHaveLength(5);
  });
});

describe("acknowledge and dismiss", () => {
  it("acknowledging tracks the insight, which then shows Issue #N", async () => {
    const store = new MemoryIssueStore("w1");
    const s = state(store);
    const d = det("a", "bad", 300);
    const before = buildInsights(registerEntries([], [d]), []);
    const row = await acknowledgeInsight(s, before[0]!, ctx);
    expect(row?.detected_key).toBe("capacity:role:a");
    expect(row?.process_id).toBe(P1);
    const after = buildInsights(registerEntries([row!], [d]), [row!]);
    expect(after).toHaveLength(1);
    expect(after[0]!.issue?.id).toBe(row!.id);
    expect(after[0]!.issueNumber).toBe(1);
  });

  it("numbers issues in the order they were logged", () => {
    const rows = [
      { id: "x", created_at: "2026-01-02" },
      { id: "y", created_at: "2026-01-01" },
    ] as never[];
    expect([...issueNumbers(rows)]).toEqual([
      ["y", 1],
      ["x", 2],
    ]);
  });

  it("dismissing leaves the insight off the list for good", async () => {
    const store = new MemoryIssueStore("w1");
    const d = det("a", "bad", 300);
    const [i] = buildInsights(registerEntries([], [d]), []);
    expect(await dismissInsight(state(store), i!, ctx)).toBe(true);
    const row = [...(store as unknown as { rows: Map<string, never> }).rows.values()][0] as { status: string };
    expect(row.status).toBe("dismissed");
    expect(buildInsights(registerEntries([row as never], [d]), [row as never])).toEqual([]);
  });
});

describe("D24: unacknowledged insights never reach the map", () => {
  const found = [det("a", "risk", 100), det("b", "bad", 50)];

  it("adds no badge and no colour for what a run only found", () => {
    const entries = registerEntries([], found);
    expect(confirmedBadges(entries)).toEqual({});
    expect(confirmedRatings(entries)).toEqual({});
    // The only thing that counts findings per step is the helper the map never reads.
    expect(Object.keys(stepBadges(entries))).toHaveLength(2);
  });

  it("badges the step only once the insight is acknowledged", async () => {
    const store = new MemoryIssueStore("w1");
    const [i] = buildInsights(registerEntries([], found), []);
    const row = await acknowledgeInsight(state(store), i!, ctx);
    const entries = registerEntries([row!], found);
    expect(Object.keys(confirmedBadges(entries))).toEqual([uuid("a")]);
  });

  it("the insights components never feed the map's badges or colours", () => {
    const src = readFileSync(join(__dirname, "..", "src", "components", "insights.tsx"), "utf8");
    expect(src).not.toMatch(/confirmedBadges|confirmedRatings|stepBadges|openIssues|stepExtras/);
  });
});
