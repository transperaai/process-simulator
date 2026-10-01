import { describe, expect, it } from "vitest";
import {
  causeStopsAtPerson,
  countFilled,
  countFlags,
  describeTarget,
  detectIssues,
  emptyFirstPrinciples,
  firstPrinciplesFlags,
  firstPrinciplesSummary,
  measuresMetToday,
  normalizeFirstPrinciples,
  oversizedParts,
  northbeamWithServicing,
  ownerProblem,
  simulate,
  stepsFilled,
  successMeasureSource,
  type FirstPrinciples,
  type FpContext,
} from "../src";

// First principles (issue #119, A54): the rule checks in pure code, the reader for stored JSON, and the bridge to
// rule 11 (goals met).

const ctx: FpContext = {
  steps: [
    { id: "s-enrich", name: "Enrich in CRM" },
    { id: "s-audit", name: "Audit & proposal" },
  ],
  people: [
    { id: "p-maya", name: "Maya Collins" },
    { id: "p-tom", name: "Tom Reed" },
  ],
  roles: [{ name: "Strategist" }, { name: "Account manager" }],
};

const fp = (patch: Partial<FirstPrinciples> = {}): FirstPrinciples => ({ ...emptyFirstPrinciples(), ...patch });
const codes = (f: FirstPrinciples, key: keyof ReturnType<typeof firstPrinciplesFlags>, c: FpContext = ctx) => firstPrinciplesFlags(f, c)[key].map((x) => x.code);
const req = (over: Partial<FirstPrinciples["requirements"][number]> = {}): FirstPrinciples["requirements"][number] => ({
  text: "Every proposal is reviewed",
  owner_person_id: null,
  owner_text: "",
  why: "Pricing errors reached clients",
  verdict: "keep",
  step_id: null,
  ...over,
});
const del = (step_id: string, added_back = false) => ({ step_id, breaks_if_removed: "", agreed_by: null, added_back });

describe("requirement owners", () => {
  it("passes a person from People, or a typed name that matches one", () => {
    expect(ownerProblem(req({ owner_person_id: "p-maya" }), ctx)).toBeNull();
    expect(ownerProblem(req({ owner_text: "tom reed" }), ctx)).toBeNull();
  });
  it("passes a named person who is not in People", () => {
    expect(ownerProblem(req({ owner_text: "Priya (client's finance lead)" }), ctx)).toBeNull();
  });
  it("flags a team, a function or a role name, with or without 'the'", () => {
    for (const t of ["Finance", "the legal department", "Sales team", "Strategist", "The Account manager", "Board", "HR"]) {
      expect(ownerProblem(req({ owner_text: t }), ctx), t).toBe("team");
    }
  });
  it("flags a blank owner and a person id that no longer exists", () => {
    expect(ownerProblem(req(), ctx)).toBe("missing");
    expect(ownerProblem(req({ owner_person_id: "gone" }), ctx)).toBe("missing");
  });
  it("raises a flag per requirement, naming the team", () => {
    const flags = firstPrinciplesFlags(fp({ requirements: [req({ owner_text: "Finance" }), req({ text: "B", owner_person_id: "p-maya" })] }), ctx).reqs;
    expect(flags.map((f) => f.code)).toEqual(["owner_team"]);
    expect(flags[0]!.text).toContain("Finance");
    expect(flags[0]!.level).toBe("bad");
  });
  it("flags a reason that is habit or blank", () => {
    expect(codes(fp({ requirements: [req({ owner_person_id: "p-maya", why: "We've always done it" })] }), "reqs")).toEqual(["no_reason"]);
    expect(codes(fp({ requirements: [req({ owner_person_id: "p-maya", why: "" })] }), "reqs")).toEqual(["no_reason"]);
  });
});

describe("the order check", () => {
  const auto = { step_id: "s-enrich", stage: "automate" as const, text: "AI enrichment", scenario_id: null };

  it("flags automating or accelerating a delete candidate", () => {
    expect(codes(fp({ deletes: [del("s-enrich")], improvements: [auto] }), "saa")).toEqual(["order"]);
    expect(codes(fp({ deletes: [del("s-enrich")], improvements: [{ ...auto, stage: "accelerate" }] }), "saa")).toEqual(["order"]);
  });
  it("leaves simplifying a delete candidate alone, and a different step", () => {
    expect(codes(fp({ deletes: [del("s-enrich")], improvements: [{ ...auto, stage: "simplify" }] }), "saa")).toEqual([]);
    expect(codes(fp({ deletes: [del("s-enrich")], improvements: [{ ...auto, step_id: "s-audit" }] }), "saa")).toEqual([]);
  });
  it("stops flagging once the step is added back", () => {
    expect(codes(fp({ deletes: [del("s-enrich", true)], improvements: [auto] }), "saa")).toEqual([]);
  });
  it("warns when the step's requirement is still being challenged", () => {
    const f = fp({ requirements: [req({ step_id: "s-enrich", verdict: "challenge", owner_person_id: "p-maya" })], improvements: [auto] });
    expect(codes(f, "saa")).toEqual(["order_challenged"]);
    expect(codes({ ...f, requirements: [{ ...f.requirements[0]!, verdict: "keep" }] }, "saa")).toEqual([]);
  });
  it("names the step", () => {
    expect(firstPrinciplesFlags(fp({ deletes: [del("s-enrich")], improvements: [auto] }), ctx).saa[0]!.text).toContain("Enrich in CRM");
  });
});

describe("the delete list", () => {
  it("nudges when empty", () => {
    expect(codes(fp(), "del")).toEqual(["no_deletes"]);
  });
  it("counts what was added back", () => {
    const flag = firstPrinciplesFlags(fp({ deletes: [del("a", true), del("b")] }), ctx).del[0]!;
    expect(flag.level).toBe("ok");
    expect(flag.text).toContain("50%");
  });
});

describe("the root cause", () => {
  it("flags a cause that names a person from People, by first or full name", () => {
    expect(causeStopsAtPerson("Because Tom is slow", ctx.people)).toBe("Tom Reed");
    expect(causeStopsAtPerson("Maya Collins signs everything off", ctx.people)).toBe("Maya Collins");
  });
  it("flags blaming phrases without a name", () => {
    expect(causeStopsAtPerson("The strategist is too busy", ctx.people)).toMatch(/busy/);
    expect(causeStopsAtPerson("Human error", ctx.people)).toMatch(/human error/i);
  });
  it("does not mistake an ordinary word for a first name", () => {
    const people = [{ name: "Will Park" }, { name: "Mark Lee" }, { name: "Grant Fox" }];
    expect(causeStopsAtPerson("No one will check the pricing, and the mark-up is a grant of discretion", people)).toBeNull();
    expect(causeStopsAtPerson("Will is slow to review", people)).toBe("Will Park");
    expect(causeStopsAtPerson("will park reviews everything", people)).toBe("Will Park");
  });
  it("does not match part of a word", () => {
    expect(causeStopsAtPerson("Thomas Cook pricing rules are not written down", ctx.people)).toBeNull();
    expect(causeStopsAtPerson("There are no written pricing and scoping rules", ctx.people)).toBeNull();
  });
  it("flags in the checks, and passes a process cause", () => {
    const why = (root: string) => fp({ why: { problem: "Late proposals", chain: ["Tom is slow"], root } });
    expect(codes(why("Tom is slow at reviewing"), "why")).toEqual(["root_person"]);
    expect(codes(why("No written pricing rules"), "why")).toEqual(["root_ok"]);
    expect(codes(why(""), "why")).toEqual(["no_root"]);
  });
});

describe("success measures", () => {
  const m = (over: Partial<FirstPrinciples["measures"][number]> = {}): FirstPrinciples["measures"][number] => ({
    id: "m1",
    text: "Win rate above 25%",
    kpi: "winRate",
    comparator: "atLeast",
    target: 0.25,
    horizon: "6 months",
    ...over,
  });
  it("flags a measure that maps to no engine number", () => {
    expect(codes(fp({ measures: [m({ kpi: null, target: null })] }), "measures")).toEqual(["measure_unmapped"]);
  });
  it("flags a mapped measure with no target, and passes a complete one", () => {
    expect(codes(fp({ measures: [m({ target: null })] }), "measures")).toEqual(["measure_no_target"]);
    expect(codes(fp({ measures: [m()] }), "measures")).toEqual([]);
  });
  it("nudges when there are none", () => {
    expect(codes(fp(), "measures")).toEqual(["no_measures"]);
  });
  it("flags a measure met in under half the runs", () => {
    const model = northbeamWithServicing();
    const result = simulate(model, 6, 1);
    const f = fp({ measures: [m({ kpi: "won", comparator: "atLeast", target: 1e9 })] });
    const [row] = measuresMetToday(f, model, result);
    expect(row!.metShare).toBe(0);
    const flags = firstPrinciplesFlags(f, { ...ctx, checks: [row!.check!] });
    expect(flags.measures.map((x) => x.code)).toEqual(["measure_missed"]);
  });
  it("describes targets in the unit a person types", () => {
    expect(describeTarget(m())).toBe("at least 25 %");
    expect(describeTarget(m({ kpi: "cycleHours", comparator: "atMost", target: 120 }))).toBe("at most 120 working hours");
    expect(describeTarget(m({ target: null }))).toBe("No target");
  });
});

describe("goals met (rule 11) reads the success measures", () => {
  const model = northbeamWithServicing();
  const result = simulate(model, 8, 1);
  const won = result.samples.won;
  const mean = won.reduce((a, b) => a + b, 0) / won.length;

  it("rates a measure the engine computes, and leaves the others unrated", () => {
    const f = fp({
      measures: [
        { id: "a", text: "Wins", kpi: "won", comparator: "atLeast", target: mean * 0.5, horizon: "" },
        { id: "b", text: "Clients feel looked after", kpi: null, comparator: "atLeast", target: null, horizon: "" },
        { id: "c", text: "No target yet", kpi: "won", comparator: "atLeast", target: null, horizon: "" },
      ],
    });
    const rows = measuresMetToday(f, model, result);
    expect(rows[0]!.metShare).toBe(1);
    expect(rows[1]!.check?.status).toBe("not_checked");
    expect(rows[2]!.check?.status).toBe("not_checked");
    const issues = detectIssues(model, result, undefined, { successMeasures: successMeasureSource(f, "proc") });
    expect(issues.filter((i) => i.key.startsWith("success:"))).toEqual([]);
  });

  it("raises a finding when too few runs meet the target", () => {
    const f = fp({ measures: [{ id: "a", text: "Wins", kpi: "won", comparator: "atLeast", target: mean * 100, horizon: "" }] });
    const issues = detectIssues(model, result, undefined, { successMeasures: successMeasureSource(f, "proc") });
    const found = issues.filter((i) => i.key === "success:measure:a");
    expect(found).toHaveLength(1);
    expect(found[0]!.rating).toBe("risk");
  });
});

describe("progress and the reader", () => {
  it("counts the steps with an answer", () => {
    expect(countFilled(emptyFirstPrinciples())).toBe(0);
    const f = fp({
      job: { who: "Founders", progress: "More enquiries", situation: "", done: "Signed" },
      deletes: [del("s")],
      measures: [{ id: "m1", text: "x", kpi: "won", comparator: "atLeast", target: 3, horizon: "" }],
    });
    expect(stepsFilled(f)).toMatchObject({ job: true, del: true, measures: true, truths: false, why: false });
    expect(countFilled(f)).toBe(3);
  });
  it("counts flags that need attention, not the ok and info ones", () => {
    const flags = firstPrinciplesFlags(fp({ deletes: [del("s")] }), ctx);
    expect(flags.del.map((f) => f.level)).toEqual(["info"]);
    // The three job fields, no root cause and no measures.
    expect(countFlags(flags)).toBe(5);
  });
  it("reads anything without throwing", () => {
    for (const bad of [null, 7, "x", [], { job: 5, statements: "no", measures: [1, null, { kpi: "nonsense", target: "x" }] }]) {
      expect(normalizeFirstPrinciples(bad).why.chain).toHaveLength(1);
    }
  });
  it("gives every measure its own id and drops an unknown KPI or a non-number target", () => {
    const n = normalizeFirstPrinciples({ measures: [{ kpi: "nonsense", target: "x" }, { id: "m1" }, { id: "m1", kpi: "won", target: 4 }] });
    expect(n.measures.map((m) => [m.id, m.kpi, m.target])).toEqual([
      ["m1", null, null],
      ["m1_", null, null],
      ["m1__", "won", 4],
    ]);
  });
  it("cuts lists and texts to their limits and drops deletes with no step", () => {
    const n = normalizeFirstPrinciples({
      job: { who: "x".repeat(5000) },
      statements: Array.from({ length: 80 }, () => ({ text: "t", kind: "truth" })),
      deletes: [{ step_id: "" }, { step_id: "a" }],
    });
    expect(n.job.who).toHaveLength(2000);
    expect(n.statements).toHaveLength(50);
    expect(n.deletes.map((d) => d.step_id)).toEqual(["a"]);
  });
  it("round-trips its own output", () => {
    const f = fp({ job: { who: "a", progress: "b", situation: "c", done: "d" }, requirements: [req({ owner_person_id: "p-maya" })] });
    expect(normalizeFirstPrinciples(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });
  it("summarises for the process page", () => {
    const f = fp({
      job: { who: "w", progress: " More enquiries ", situation: "", done: "d" },
      requirements: [req({ verdict: "challenge" }), req({ verdict: "keep" })],
      deletes: [del("a"), del("b", true)],
    });
    expect(firstPrinciplesSummary(f)).toMatchObject({ job: "More enquiries", challenged: 1, deleteCandidates: 1 });
  });
});

describe("size limits", () => {
  it("takes the largest list the app allows, in plain text, and refuses one made large with wide characters", () => {
    const text = "x".repeat(2000);
    const ascii = fp({ statements: Array.from({ length: 50 }, () => ({ text, kind: "truth" as const, source: text, test: text, linked_parameter: null })) });
    expect(oversizedParts(normalizeFirstPrinciples(ascii))).toEqual([]);
    const wide = "😀".repeat(2000);
    const emoji = fp({ statements: Array.from({ length: 50 }, () => ({ text: wide, kind: "truth" as const, source: wide, test: wide, linked_parameter: null })) });
    expect(oversizedParts(normalizeFirstPrinciples(emoji))).toEqual(["statements"]);
  });
});
