import { describe, expect, it } from "vitest";
import { checkNumbers, factsFromText, scanNumbers, type CheckContext, type Fact } from "@/lib/narration/numbers";

// The narration number check (issue #29; docs/PRD.md §7.3, D15): every number
// a model writes must be one of the report's figures, rounded and formatted
// honestly. Adversarial cases: invented figures, false precision, rounding
// too coarse, the wrong currency, % for points, the wrong sign, dates and
// week numbers nobody gave, numbers in words.

const facts: Fact[] = [
  { key: "mrr.mean", kind: "money", value: 4213, step: 0 },
  { key: "mrr.p10", kind: "money", value: 3100, step: 0 },
  { key: "mrr.p90", kind: "money", value: 5040, step: 0 },
  { key: "billed.mean", kind: "money", value: 349_352.61, step: 0 },
  { key: "big.mean", kind: "money", value: 1_234_000, step: 0 },
  { key: "won.mean", kind: "plain", value: 8.6, step: 0 },
  { key: "won.p10", kind: "plain", value: 6, step: 0 },
  { key: "won.p90", kind: "plain", value: 12, step: 0 },
  { key: "util.mean", kind: "percent", value: 96.52, step: 0 },
  { key: "util.p10", kind: "percent", value: 86.68, step: 0 },
  { key: "util.p90", kind: "percent", value: 101.33, step: 0 },
  { key: "holds", kind: "percent", value: 94, step: 0 },
  { key: "cycle.mean", kind: "hours", value: 225.04, step: 0 },
  { key: "delta.cycle", kind: "days", value: -9.7, step: 0.1 },
  { key: "delta.mrr", kind: "money", value: -1400, step: 1 },
  { key: "delta.util", kind: "points", value: -12, step: 1 },
  { key: "weeks", kind: "weeks", value: 13, step: 0 },
  { key: "reps", kind: "plain", value: 200, step: 0 },
  { key: "atRisk", kind: "plain", value: 3, step: 0 },
];

const ctx: CheckContext = { facts, dates: ["2026-09-30"], names: ["Hire 2 strategists", "Lead to live"], currency: "GBP", hoursPerDay: 8 };

const ok = (text: string) => {
  const r = checkNumbers(text, ctx);
  expect(r.problems, text).toEqual([]);
  return r;
};
const bad = (text: string) => {
  const r = checkNumbers(text, ctx);
  expect(r.ok, text).toBe(false);
  return r.problems.map((p) => p.text);
};

describe("figures that match", () => {
  it("accepts exact and correctly rounded money (the PRD's £4,213 ≈ £4.2k)", () => {
    ok("New MRR is £4,213.");
    ok("New MRR is £4.2k.");
    ok("New MRR is £4.21k.");
    ok("New MRR is GBP 4,213.");
    ok("Billed £349.4k, or £349k, or £349,353.");
    ok("It bills £1.2m.");
    ok("It bills £1.23 million.");
  });

  it("accepts ranges with a shared currency, scale and unit", () => {
    ok("avg £4.2k (range £3.1–5.0k)");
    ok("avg £4.2k (range £3.1k–£5.0k)");
    ok("avg £4.2k (range £3,100 to £5,040)");
    ok("Strategist is 97% utilised (range 87–101%).");
    ok("wins avg 8.6 (range 6–12)");
    ok("wins avg 8.6 (range 6 to 12)");
    ok("wins 9 on average (between 6 and 12)");
  });

  it("reads hours as days at the workspace's day length, and signed deltas", () => {
    ok("A lead takes avg 28 d from arrival to an outcome.");
    ok("A lead takes about 28.1 working days.");
    ok("Cycle time falls by 9.7 days.");
    ok("Cycle time changes by −9.7 d.");
    ok("New MRR changes by −£1,400 at the low end.");
    ok("Utilisation falls by 12 percentage points.");
    ok("Utilisation falls by 12 pts.");
  });

  it("treats years of given dates, given dates, percentile labels and names as not figures", () => {
    ok("Over the 13 weeks from 30 Sept 2026, the business bills £349k.");
    ok("From 30 September 2026 onwards; in 2026.");
    ok("Ranges run from the 10th to the 90th percentile; P90 and P50 are shown.");
    ok("The 10th–90th percentile range is shown.");
    ok("“Hire 2 strategists” adds wins.");
    ok("This run of Lead to live used 200 replications.");
  });

  it("accepts whole units of small counts and numbers in words that are facts", () => {
    ok("About 9 wins.");
    ok("three clients end at risk");
    ok("One more person helps.");
    ok("The queue of wins may grow.");
  });
});

describe("figures that don't", () => {
  it("rejects invented figures", () => {
    expect(bad("New MRR is £5,000.")).toEqual(["£5,000"]);
    expect(bad("wins avg 8.6 (range 6–14)")).toEqual(["14"]);
    expect(bad("Strategist is 91% utilised.")).toEqual(["91%"]);
    expect(bad("It saves 17 hours a week.")).toEqual(["17 hours"]);
  });

  it("rejects false precision and rounding too coarse", () => {
    expect(bad("Cycle time falls by 9.71 days.")).toEqual(["9.71 days"]);
    expect(bad("New MRR is about £4k.")).toEqual(["£4k"]);
    expect(bad("It bills £1m.")).toEqual(["£1m"]);
    expect(bad("New MRR is £4.3k.")).toEqual(["£4.3k"]);
  });

  it("rejects the wrong currency, unit or kind", () => {
    expect(bad("New MRR is $4,213.")).toEqual(["$4,213"]);
    expect(bad("New MRR is €4.2k.")).toEqual(["€4.2k"]);
    expect(bad("New MRR is 4,213.")).toEqual(["4,213"]);
    expect(bad("Utilisation falls by 12%.")).toEqual(["12%"]);
    expect(bad("It holds in 94 points of cases.")).toEqual(["94 points"]);
    expect(bad("The team is 8.6% busier.")).toEqual(["8.6%"]);
  });

  it("rejects the wrong sign when a sign is written", () => {
    expect(bad("Cycle time changes by +9.7 d.")).toEqual(["+9.7 d"]);
    expect(bad("New MRR changes by +£1,400.")).toEqual(["+£1,400"]);
    ok("New MRR could fall by £1,400.");
  });

  it("rejects dates, week numbers and quarters nobody gave", () => {
    expect(bad("By 14 October 2026 the queue doubles.").sort()).toEqual(["14 October 2026", "doubles"].sort());
    expect(bad("By week 6 the queue is full.")).toEqual(["week 6"]);
    expect(bad("Revenue in Q3 is £349k.")).toEqual(["Q3"]);
    expect(bad("By week 13 the queue is full; in week 3 it starts.")).toEqual(["week 3"]);
    expect(bad("In 2027 revenue grows.")).toEqual(["2027"]);
    expect(bad("On 2026-10-14 it peaks.")).toEqual(["2026-10-14"]);
  });

  it("rejects numbers and multiples in words", () => {
    expect(bad("seven clients end at risk")).toEqual(["seven"]);
    expect(bad("twenty-five leads a week")).toEqual(["twenty-five"]);
    expect(bad("Hiring roughly doubles wins.")).toEqual(["doubles"]);
    expect(bad("Wins rise by half.")).toEqual(["half"]);
    expect(bad("hundreds of leads")).toEqual(["hundreds"]);
  });

  it("finds digits inside names it wasn't given, and negative numbers", () => {
    expect(bad("“Hire 5 strategists” adds wins.")).toEqual(["5"]);
    expect(bad("WIP falls to −4.")).toEqual(["−4"]);
  });
});

describe("reading the engine's own text", () => {
  it("knows each printed figure to the precision printed", () => {
    const { facts: read, dates } = factsFromText("headline", "New MRR changes by avg £8,575 a quarter (range −£1,400 to £22.4k). Over 13 weeks from 30 Sept 2026.");
    expect(read.map((f) => [f.kind, f.value, f.step])).toEqual([
      ["money", 8575, 1],
      ["money", -1400, 1],
      ["money", 22400, 100],
      ["weeks", 13, 1],
    ]);
    expect(dates).toEqual(["2026-09-30"]);
  });

  it("refuses more precision than the text gives", () => {
    const { facts: read } = factsFromText("t", "avg £22.4k");
    const c: CheckContext = { ...ctx, facts: read };
    expect(checkNumbers("£22.4k", c).ok).toBe(true);
    expect(checkNumbers("£22k", c).ok).toBe(true);
    expect(checkNumbers("£22,400", c).ok).toBe(false);
  });

  it("scans signs, ranges and units", () => {
    const s = scanNumbers("range 87–101%, −18.2 d to −1.2 d, £3.1–5.0k, 0 to +6, 12-week run");
    expect(s.tokens.map((t) => [t.kind, t.value, t.signed])).toEqual([
      ["percent", 87, false],
      ["percent", 101, false],
      ["days", -18.2, true],
      ["days", -1.2, true],
      ["money", 3100, false],
      ["money", 5000, false],
      ["plain", 0, false],
      ["plain", 6, true],
      ["weeks", 12, false],
    ]);
  });
});
