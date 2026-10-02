import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_WORKSPACE_ID, northbeamIssues, northbeamStepIds as ids, toEngineModel, type SolutionIssueRow, type SolutionRow } from "@transpera-flow/db";
import { STABLE_MARKET, withMarketCondition } from "@transpera-flow/engine";
import { MrrChart } from "@/components/overview/charts";
import { demoMarket } from "@/lib/market-demo";
import { solutionCopy } from "@/lib/solutions/bundle";
import { compareMaps, overallResult, stressConditions, stressTargets, toneWord } from "@/lib/solutions/compare";
import { solutionType } from "@/lib/solutions/cards";
import { runStress, type StressRow } from "@/lib/solutions/stress";
import { checkTarget } from "@/lib/solutions/verdict";
import { simulate } from "@transpera-flow/engine";
import { demoBundle } from "@/lib/sources/demo";

// The Solution page's comparison (issue #115, A50 slice 2): the two maps, the market conditions to stress under, the targets checked,
// and the stress runner itself, which the worker calls.

const base = demoBundle();
const issues = northbeamIssues();
const [issue] = issues;
const edited = { ...base, steps: base.steps.map((s) => (s.id === ids.audit ? { ...s, work_hours: 2, work_dist: "constant" as const } : s)) };
const stamp = "2026-10-05T10:00:00.000Z";
const solution: SolutionRow = {
  id: "00000000-0000-4000-8000-0000000000aa",
  workspace_id: NORTHBEAM_WORKSPACE_ID,
  process_id: NORTHBEAM_PROCESS_ID,
  base_revision_id: base.revision.id,
  name: "Faster audit",
  notes: "",
  steps: solutionCopy(edited),
  changed_step_ids: [ids.audit],
  lever_changes: [],
  created_at: stamp,
  updated_at: stamp,
  created_by: null,
};
const link: SolutionIssueRow = {
  solution_id: solution.id,
  issue_id: issue!.id,
  workspace_id: NORTHBEAM_WORKSPACE_ID,
  auto_verdict: null,
  holds_pct: null,
  auto_note: "",
  user_verdict: null,
  user_notes: "",
  created_at: stamp,
  updated_at: stamp,
  created_by: null,
};

describe("the two maps", () => {
  it("sets the solution's copy against the version it was copied from and finds what changed", () => {
    const c = compareMaps(base, solution);
    expect(c.changed).toEqual([ids.audit]);
    expect(c.diff.steps.get(ids.audit)?.kind).toBe("changed");
    expect(c.solved.steps.find((s) => s.id === ids.audit)?.work_hours).toBe(2);
    expect(c.base.steps.find((s) => s.id === ids.audit)?.work_hours).not.toBe(2);
  });

  it("opens the groups that hold a changed step, on both maps", () => {
    const group = { ...base.steps[0]!, id: "00000000-0000-4000-8000-0000000000c1", kind: "group" as const, name: "Sales", parent_step_id: null };
    const nested = { ...base, steps: [group, ...base.steps.map((s) => (s.id === ids.audit ? { ...s, parent_step_id: group.id } : s))] };
    const c = compareMaps(nested, { steps: solutionCopy({ steps: nested.steps.map((s) => (s.id === ids.audit ? { ...s, work_hours: 1 } : s)), edges: nested.edges }) });
    expect([...c.open]).toEqual([group.id]);
  });
});

describe("the markets", () => {
  it("runs the workspace's conditions, presets first and then its own", () => {
    const conditions = stressConditions(demoMarket().marketConditions);
    expect(conditions.map((c) => c.name)).toEqual(["Boom", "Stable", "Soft", "Downturn", "Cautious 2027"]);
    expect(conditions.at(-1)).toMatchObject({ preset: null, factors: { leads: 0.92, churn: 1.08 } });
    expect(conditions[1]!.factors).toEqual(STABLE_MARKET);
  });

  it("falls back to the four presets when the workspace has none", () => {
    expect(stressConditions(undefined).map((c) => c.name).sort()).toEqual(["Boom", "Downturn", "Soft", "Stable"]);
    expect(stressConditions([]).length).toBe(4);
  });
});

describe("the targets and the result", () => {
  it("checks each issue the solution solves, over the steps the solution's map has in its area", () => {
    const c = compareMaps(base, solution);
    const targets = stressTargets(c, [link, { ...link, issue_id: "gone" }], issues, NORTHBEAM_PROCESS_ID);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ issueId: issue!.id, number: issue!.number, target: { goal: issue!.target_goal } });
    expect(targets[0]!.area).toContain(ids.audit);
  });

  it("is a pass only if every issue that could be checked passes", () => {
    expect(overallResult([{ status: "pass" }, { status: "pass" }])).toBe("pass");
    expect(overallResult([{ status: "pass" }, { status: "fail" }])).toBe("fail");
    expect(overallResult([{ status: "pass" }, { status: "unchecked" }])).toBe("pass");
    expect(overallResult([{ status: "unchecked" }])).toBe("unchecked");
    expect(overallResult([])).toBe("unchecked");
  });

  it("words the engine's tone as better, worse or about the same", () => {
    expect([toneWord("good"), toneWord("bad"), toneWord(null)]).toEqual(["Better", "Worse", "About the same"]);
  });
});

describe("the stress runner", () => {
  const c = compareMaps(base, solution);
  const baseModel = toEngineModel(c.base);
  const solved = toEngineModel(c.solved);
  const targets = stressTargets(c, [link], issues, NORTHBEAM_PROCESS_ID);
  const conditions = stressConditions(demoMarket().marketConditions).filter((x) => ["stable", "downturn"].includes(x.preset ?? ""));
  const run = (): StressRow[] => {
    const rows: StressRow[] = [];
    runStress({ base: baseModel, solved, conditions, targets, reps: 6, seed: 1 }, (r) => rows.push(r));
    return rows;
  };

  it("hands back a row per condition, in order, as each is done", () => {
    const rows = run();
    expect(rows.map((r) => r.name)).toEqual(["Stable", "Downturn"]);
    for (const r of rows) {
      expect(r.verdicts).toHaveLength(1);
      expect(["pass", "fail", "unchecked"]).toContain(r.verdicts[0]!.status);
      expect(r.mrr.live).toBeGreaterThan(0);
      expect(r.mrr.solution).toBeGreaterThan(0);
    }
    // The market changes the numbers: a downturn bills less than a stable market.
    expect(rows[1]!.mrr.solution).toBeLessThan(rows[0]!.mrr.solution);
  });

  it("uses the same goal reading and verdict as the Editor and the server", () => {
    const stable = run()[0]!;
    const model = withMarketCondition(solved, STABLE_MARKET);
    const direct = checkTarget({ target: targets[0]!.target, model, result: simulate(model, 6, 1), area: targets[0]!.area });
    expect(stable.verdicts[0]).toMatchObject({ status: direct.status, holdsPct: direct.holdsPct, note: direct.note });
  });

  it("gives the same answer every time", () => {
    expect(run()).toEqual(run());
  });
});

describe("the solution's type", () => {
  it("reads AI block for a solution built from an AI idea, and By hand otherwise or when nothing is known", () => {
    expect(solutionType({ id: "s1" }, ["s1"])).toBe("AI block");
    expect(solutionType({ id: "s2" }, ["s1"])).toBe("By hand");
    expect(solutionType({ id: "s1" })).toBe("By hand");
  });
});

describe("the revenue chart with a second line", () => {
  const points = [0, 1, 2].map((m) => ({ month: m, mean: 1000 + m * 100, lo: 900 + m * 100, hi: 1100 + m * 100 }));
  it("draws the solution's line and carries its numbers for a screen reader", () => {
    const html = renderToStaticMarkup(createElement(MrrChart, { points, compare: points.map((p) => ({ ...p, mean: p.mean + 50 })), horizonMonths: 2, currency: "GBP", compareName: "With solution" }));
    expect(html).toContain("data-compare-line");
    expect(html).toContain("With solution");
    expect(renderToStaticMarkup(createElement(MrrChart, { points, horizonMonths: 2, currency: "GBP" }))).not.toContain("data-compare-line");
  });
});
