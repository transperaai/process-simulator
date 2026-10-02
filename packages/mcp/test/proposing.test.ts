import { describe, expect, it } from "vitest";
import { buildIssueProposal, buildSolutionIdeaProposal, matchIssue, MAX_PROPOSED_STEPS, requireSwitch } from "../src";
import { ToolError } from "../src/result";

// What the proposal tools store (issue #117, A52): a proposed issue or a solution idea, never an issue or a solution.

const fails = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe(code);
    return err as ToolError;
  }
  throw new Error("expected a ToolError");
};

const proc = "5a000000-0000-4000-8000-000000000001";
const step = "5a000000-0000-4000-8000-000000000002";

describe("buildIssueProposal", () => {
  it("builds a proposed issue with what it touches and its target", () => {
    const p = buildIssueProposal({
      title: "  Ad-hoc requests wait 20 h  ",
      detail: " From the 30 Sep call ",
      severity: "warning",
      links: [{ process_id: proc, step_id: step }],
      target_measure: "Wait at Ad-hoc requests",
      target_now: "20 h",
      target_goal: " under 8 h ",
      note: "Said twice",
    });
    expect(p).toEqual({
      kind: "issue",
      title: "Ad-hoc requests wait 20 h",
      detail: "From the 30 Sep call",
      payload: {
        severity: "warning",
        type: "manual",
        links: [{ process_id: proc, step_id: step }],
        target_measure: "Wait at Ad-hoc requests",
        target_now: "20 h",
        target_goal: "under 8 h",
      },
      evidence: [],
      note: "Said twice",
      issue_id: null,
    });
  });

  it("leaves out what wasn't given, and is for no issue yet", () => {
    const p = buildIssueProposal({ title: "Proposals go out late", severity: "serious", type: "delay", links: [] });
    expect(p.payload).toEqual({ severity: "serious", type: "delay" });
    expect(p.detail).toBeNull();
    expect(p.issue_id).toBeNull();
  });

  it("links the whole process or steps, not both", () => {
    fails(
      () => buildIssueProposal({ title: "X", severity: "info", links: [{ process_id: proc, step_id: null }, { process_id: proc, step_id: step }] }),
      "invalid_input",
    );
  });

  it("refuses an empty or over-long title and over-long targets", () => {
    fails(() => buildIssueProposal({ title: "   ", severity: "info", links: [] }), "invalid_input");
    fails(() => buildIssueProposal({ title: "x".repeat(201), severity: "info", links: [] }), "invalid_input");
    fails(() => buildIssueProposal({ title: "X", severity: "info", links: [], target_goal: "x".repeat(201) }), "invalid_input");
  });
});

describe("buildSolutionIdeaProposal", () => {
  const issue = "5a000000-0000-4000-8000-000000000009";

  it("chains the steps in order and keeps what they replace and what is expected", () => {
    const p = buildSolutionIdeaProposal({
      issue_id: issue,
      title: "Fast-track partner leads past Check fit",
      detail: "Partner leads convert twice as well.",
      steps: [
        { name: "Partner lead arrives", kind: "start" },
        { name: " Book call ", role: "Sales", block_id: "5a000000-0000-4000-8000-0000000000b1" },
        { name: "Qualify with AI", ai: true },
      ],
      replaces_step_ids: [step, step],
      expect: "First contact under 2 h",
    });
    expect(p).toMatchObject({ kind: "solution_idea", issue_id: issue, title: "Fast-track partner leads past Check fit", note: null });
    expect(p.payload).toEqual({
      steps: [
        { key: "s1", name: "Partner lead arrives", kind: "start" },
        { key: "s2", name: "Book call", role: "Sales", block_id: "5a000000-0000-4000-8000-0000000000b1" },
        { key: "s3", name: "Qualify with AI", ai: true },
      ],
      edges: [
        { from: "s1", to: "s2" },
        { from: "s2", to: "s3" },
      ],
      replaces_step_ids: [step],
      expect: "First contact under 2 h",
    });
  });

  it("a single step has no edges", () => {
    const p = buildSolutionIdeaProposal({ issue_id: issue, title: "Auto-reply", steps: [{ name: "Auto-reply" }] });
    expect(p.payload).toEqual({ steps: [{ key: "s1", name: "Auto-reply" }], edges: [] });
  });

  it("needs steps, within the limit, each named", () => {
    fails(() => buildSolutionIdeaProposal({ issue_id: issue, title: "X", steps: [] }), "invalid_input");
    fails(() => buildSolutionIdeaProposal({ issue_id: issue, title: "X", steps: Array.from({ length: MAX_PROPOSED_STEPS + 1 }, (_, i) => ({ name: `S${i}` })) }), "invalid_input");
    fails(() => buildSolutionIdeaProposal({ issue_id: issue, title: "X", steps: [{ name: " " }] }), "invalid_input");
    fails(() => buildSolutionIdeaProposal({ issue_id: issue, title: " ", steps: [{ name: "A" }] }), "invalid_input");
  });
});

describe("matchIssue", () => {
  const issues = [
    { id: "a", number: 12, title: "Proposals go out late", status: "open" },
    { id: "b", number: 15, title: "Proposals are rewritten twice", status: "testing" },
    { id: "c", number: 16, title: "Invoices are chased by hand", status: "resolved" },
    { id: "d", number: null, title: "An insight nobody acknowledged", status: "open" },
  ];
  it("finds an issue by number, #number, id or exact title", () => {
    expect(matchIssue(issues, "12").id).toBe("a");
    expect(matchIssue(issues, "#15").id).toBe("b");
    expect(matchIssue(issues, "A").id).toBe("a");
    expect(matchIssue(issues, "proposals go out late").id).toBe("a");
  });
  it("finds the only partial title match, and asks when several match", () => {
    expect(matchIssue(issues, "go out").id).toBe("a");
    const err = fails(() => matchIssue(issues, "proposals"), "ambiguous");
    expect(err.candidates).toHaveLength(2);
  });
  it("says what is there when nothing matches, and leaves out untracked insights", () => {
    const err = fails(() => matchIssue(issues, "payroll"), "not_found");
    expect((err.candidates as { id: string }[]).map((c) => c.id)).not.toContain("d");
    fails(() => matchIssue(issues, "An insight nobody"), "not_found");
  });
  it("refuses an issue that is already closed", () => {
    fails(() => matchIssue(issues, "16"), "invalid_input");
  });
});

describe("requireSwitch", () => {
  const on = { suggest_issues: true, suggest_solutions: true };
  it("lets a proposal through when its switch is on", () => {
    expect(() => requireSwitch(on, "suggest_issues")).not.toThrow();
    expect(() => requireSwitch({ ...on, suggest_issues: false }, "suggest_solutions")).not.toThrow();
  });
  it("refuses with a clear message naming the setting when it is off", () => {
    const err = fails(() => requireSwitch({ ...on, suggest_issues: false }, "suggest_issues"), "switched_off");
    expect(err.message).toBe('Proposing issues is turned off in AI settings (Settings, AI analysis: "Suggest issues (they land in Suggestions)"). Ask an owner to turn it on.');
    expect(fails(() => requireSwitch({ ...on, suggest_solutions: false }, "suggest_solutions"), "switched_off").message).toMatch(/Proposing solution ideas is turned off in AI settings/);
  });
});
