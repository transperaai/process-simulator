import { describe, expect, it } from "vitest";
import type { LinkTargets } from "@transpera-flow/db";
import { NEEDS_LINKS, describeLink, linkArg, linkJson, resolveLink } from "../src/source-links";
import { ToolError } from "../src/result";

// How a caller's links become the ids the database stores (issue #118, A53 slice 2): by id or name, with plain refusals.

const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const S1 = "e0000000-0000-4000-8000-000000000003";
const S2 = "e0000000-0000-4000-8000-000000000009";
const I1 = "40000000-0000-4000-8000-000000000001";
const SOL = "50000000-0000-4000-8000-000000000001";
const KEY = `spof:step:${S1}`;

const targets: LinkTargets = {
  processes: [
    { id: P1, name: "Lead to live" },
    { id: P2, name: "Monthly report" },
  ],
  steps: [
    { id: S1, processId: P1, name: "Review" },
    { id: S2, processId: P2, name: "Review" },
    { id: "e0000000-0000-4000-8000-00000000000a", processId: P1, name: "Check fit" },
  ],
  insights: [{ key: KEY, title: "One person can do Review" }],
  issues: [
    { id: I1, number: 12, title: "Strategist bottleneck" },
    { id: "40000000-0000-4000-8000-000000000002", number: null, title: "Unnumbered thing" },
  ],
  solutions: [{ id: SOL, name: "Second strategist" }],
};

const resolve = (arg: Record<string, unknown>) => resolveLink(linkArg.parse(arg), targets, " in 'Co'");
const refused = (arg: Record<string, unknown>) => {
  try {
    resolve(arg);
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected a refusal");
};

describe("resolving a link", () => {
  it("takes each kind by id or name", () => {
    expect(resolve({ process: "lead to live" })).toEqual({ kind: "process", processId: P1 });
    expect(resolve({ process: P2 })).toEqual({ kind: "process", processId: P2 });
    expect(resolve({ step: "check fit" })).toEqual({ kind: "step", processId: P1, stepId: "e0000000-0000-4000-8000-00000000000a" });
    expect(resolve({ insight: KEY })).toEqual({ kind: "insight", insightKey: KEY });
    expect(resolve({ issue: 12 })).toEqual({ kind: "issue", issueId: I1 });
    expect(resolve({ issue: "#12" })).toEqual({ kind: "issue", issueId: I1 });
    expect(resolve({ issue: "unnumbered" })).toMatchObject({ kind: "issue" });
    expect(resolve({ solution: "second strategist" })).toEqual({ kind: "solution", solutionId: SOL });
  });

  it("asks which process when a step name is in two", () => {
    const e = refused({ step: "Review" });
    expect(e.code).toBe("ambiguous");
    expect(e.message).toMatch(/more than one step/);
    expect(resolve({ step: "Review", process: "Monthly report" })).toEqual({ kind: "step", processId: P2, stepId: S2 });
  });

  it("refuses an empty link, two things at once, and a process beside something other than a step", () => {
    expect(refused({}).code).toBe("invalid_input");
    expect(refused({ step: "Check fit", issue: 12 }).message).toMatch(/exactly one thing/);
    expect(refused({ process: "Lead to live", issue: 12 }).code).toBe("invalid_input");
  });

  it("says when the thing isn't there", () => {
    expect(refused({ step: "Nothing like it" }).code).toBe("not_found");
    expect(refused({ issue: 99 }).code).toBe("not_found");
    expect(refused({ solution: "Nope" }).code).toBe("not_found");
    expect(refused({ insight: "not a key" }).message).toMatch(/isn't an insight key/);
  });

  it("rejects fields it doesn't know, and a bad issue number", () => {
    expect(() => linkArg.parse({ process: "x", colour: "red" })).toThrow();
    expect(() => linkArg.parse({ issue: -1 })).toThrow();
  });
});

describe("what the caller reads back", () => {
  it("names each link", () => {
    expect(describeLink({ kind: "process", processId: P1 }, targets)).toBe("Process: Lead to live");
    expect(describeLink({ kind: "step", processId: P2, stepId: S2 }, targets)).toBe("Step: Review");
    expect(describeLink({ kind: "issue", issueId: I1 }, targets)).toBe("Issue #12");
    expect(describeLink({ kind: "insight", insightKey: KEY }, targets)).toBe("Insight: One person can do Review");
    expect(describeLink({ kind: "solution", solutionId: SOL }, targets)).toBe("Solution: Second strategist");
  });

  it("sends the database the same columns the table checks", () => {
    expect(linkJson({ kind: "step", processId: P1, stepId: S1 })).toEqual({ kind: "step", process_id: P1, step_id: S1, insight_key: null, issue_id: null, solution_id: null });
  });

  it("tells a caller of the old shape what to pass", () => {
    expect(NEEDS_LINKS).toMatch(/Pass `links`/);
    expect(NEEDS_LINKS).toMatch(/link_later: true/);
    expect(NEEDS_LINKS).toMatch(/doesn't count as evidence/);
  });
});
