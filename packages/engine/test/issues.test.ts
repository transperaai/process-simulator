import { describe, expect, it } from "vitest";
import {
  applyPatches,
  detectIssues,
  isBlocking,
  northbeamModel,
  simulate,
  type DetectedIssue,
  type EngineModel,
  type EnginePerson,
  type EngineStep,
} from "../src";

// Detected issues (issue #17): one small, hand-checkable model per detector,
// Northbeam as it is and overloaded, and stable keys.

/** One pipeline of steps in a row, each staffed by `role` unless given. 40 h weeks, 26-week horizon, no warm-up. */
function line(
  leadsPerWeek: number,
  steps: (Partial<EngineStep> & { id: string })[],
  roles: Record<string, number> = { r: 1 },
  extra: Partial<EngineModel> = {},
): EngineModel {
  return {
    horizonWeeks: 26,
    hoursPerWeek: 40,
    leadsPerWeek,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 0,
    warmupWeeks: 4,
    roles: Object.fromEntries(Object.entries(roles).map(([id, count]) => [id, { name: `Role ${id}`, count, cost: 0, ongoing: 0 }])),
    entry: steps[0]!.id,
    sinks: { won: "won", lost: "lost" },
    steps: steps.map((s, i) => ({
      name: `Step ${s.id}`,
      role: "r",
      work: 1,
      wait: 0,
      rework: 0,
      workDist: { kind: "constant" },
      next: [{ to: steps[i + 1]?.id ?? "won", p: 1 }],
      ...s,
    })),
    ...extra,
  };
}

const run = (m: EngineModel, reps = 12) => detectIssues(m, simulate(m, reps, 1));
const keys = (issues: DetectedIssue[]) => issues.map((i) => i.key);
const find = (issues: DetectedIssue[], key: string) => issues.find((i) => i.key === key);
const person = (roles: string[], extra: Partial<EnginePerson> = {}): EnginePerson => ({ name: "", roles, capacity: 40, ...extra });

/** Every suggested fix is a patch the scenario code can apply to the model. */
function fixesApply(m: EngineModel, issues: DetectedIssue[]) {
  for (const i of issues) {
    if (!i.fix) continue;
    expect(applyPatches(m, i.fix.patch).issues.filter(isBlocking), i.key).toEqual([]);
  }
}

describe("capacity: role or person over the utilisation threshold", () => {
  it("flags a role at ~90% (9 items/wk × 4 h on 40 h) and not one at ~50%", () => {
    // Offered load 9 × 4 / 40 = 0.9: over 85%, under 95%, so a warning.
    const busy = line(9, [{ id: "a", work: 4 }]);
    const issues = run(busy);
    const issue = find(issues, "capacity:role:r")!;
    expect(issue.type).toBe("capacity");
    expect(issue.severity).toBe("warning");
    expect(issue.metrics.utilisation).toBeGreaterThan(0.85);
    expect(issue.metrics.utilisation).toBeLessThan(0.95);
    expect(issue.title).toMatch(/^Role r at (8[6-9]|9\d)% utilisation$/);
    expect(issue.stepId).toBe("a");
    expect(issue.fix?.patch).toEqual([{ path: "roles.r.headcount", op: "add", value: 1 }]);
    fixesApply(busy, issues);

    expect(keys(run(line(5, [{ id: "a", work: 4 }])))).not.toContain("capacity:role:r");
  });

  it("is critical when client work alone exceeds capacity (50 clients × 1 h/wk on 40 h)", () => {
    const m = line(1, [{ id: "a", work: 1 }], { r: 1 }, { activeClients: 50 });
    m.roles.r!.ongoing = 1;
    const issue = find(run(m), "capacity:role:r")!;
    expect(issue.severity).toBe("critical");
    expect(issue.title).toBe("Role r: client work alone exceeds capacity");
    expect(issue.metrics.ongoing_hours_week).toBeCloseTo(50);
  });

  it("flags a person overloaded by a pinned step while their role has room, and names them", () => {
    // Ann is pinned to `a` (9 × 4 h = 36 h of 40); Bob does the light step `b`. The role is at ~50%.
    const m = line(9, [{ id: "a", work: 4, person: "ann" }, { id: "b", work: 0.5 }], { r: 2 }, {
      people: { ann: person(["r"], { name: "Ann", skills: ["a"] }), bob: person(["r"], { name: "Bob", skills: ["b"] }) },
    });
    const issues = run(m);
    expect(keys(issues)).not.toContain("capacity:role:r");
    const issue = find(issues, "capacity:person:ann")!;
    expect(issue.title).toMatch(/^Ann at (8[6-9]|9\d)% utilisation$/);
    expect(issue.personId).toBe("ann");
    expect(issue.stepId).toBe("a");
    fixesApply(m, issues);
  });

  it("names the only member of a flagged role on the role's issue instead of adding a person issue", () => {
    const m = line(9, [{ id: "a", work: 4 }], { r: 1 }, { people: { ann: person(["r"], { name: "Ann" }) } });
    const issues = run(m);
    expect(find(issues, "capacity:role:r")?.title).toMatch(/^Role r \(Ann\) at (8[6-9]|9\d)% utilisation$/);
    expect(find(issues, "capacity:role:r")?.personId).toBe("ann");
    expect(keys(issues)).not.toContain("capacity:person:ann");
  });
});

describe("queue growing without bound", () => {
  it("flags a step offered 10 items/wk that can clear 8 (5 h each on 40 h): the queue grows ~2 a week", () => {
    const m = line(10, [{ id: "a", work: 5 }]);
    const r = simulate(m, 12, 1);
    // Hand check: arrivals 10/wk, service 8/wk, so the backlog grows by ~2 items a week.
    expect(r.steps.a!.queueGrowth).toBeGreaterThan(1.5);
    expect(r.steps.a!.queueGrowth).toBeLessThan(2.5);
    const issues = detectIssues(m, r);
    const issue = find(issues, "queue:step:a")!;
    expect(issue.type).toBe("bottleneck");
    expect(issue.severity).toBe("critical");
    expect(issue.title).toBe("The queue at Step a keeps growing");
    // Its wait is unbounded too; the queue issue covers it.
    expect(keys(issues)).not.toContain("wait:step:a");
  });

  it("doesn't flag a stable queue (70% load)", () => {
    const r = simulate(line(7, [{ id: "a", work: 4 }]), 12, 1);
    expect(Math.abs(r.steps.a!.queueGrowth)).toBeLessThan(0.2);
    expect(keys(detectIssues(line(7, [{ id: "a", work: 4 }]), r))).not.toContain("queue:step:a");
  });
});

describe("wait over threshold", () => {
  it("flags queueing over the threshold: M/D/1 at 80% with 4 h service waits ~8 h (Pollaczek–Khinchine)", () => {
    // Wq = ρ / (2(1 − ρ)) × S = 0.8 / 0.4 × 4 h = 8 h. Under the default 16 h, over a 4 h threshold.
    const m = line(8, [{ id: "a", work: 4 }]);
    const r = simulate(m, 12, 1);
    expect(r.steps.a!.avgWait).toBeGreaterThan(6);
    expect(r.steps.a!.avgWait).toBeLessThan(10);
    expect(keys(detectIssues(m, r))).not.toContain("wait:step:a");
    const issue = find(detectIssues(m, r, { waitHours: 4 }), "wait:step:a")!;
    expect(issue.type).toBe("delay");
    // ~2× the threshold: serious (1.5×) but not critical (2.5×).
    expect(issue.severity).toBe("serious");
    expect(issue.title).toMatch(/^Work waits [\d.]+ working days? for Step a$/);
  });
});

describe("single point of failure", () => {
  it("flags a step only one person can do, and not one two people can do", () => {
    const m = line(2, [{ id: "a", role: "solo" }, { id: "b", role: "pair" }], { solo: 1, pair: 2 });
    const issues = run(m);
    const issue = find(issues, "spof:step:a")!;
    expect(issue.type).toBe("spof");
    expect(issue.severity).toBe("warning");
    expect(issue.title).toBe("Only one Role solo can do Step a");
    expect(issue.fix?.patch).toEqual([{ path: "roles.solo.headcount", op: "add", value: 1 }]);
    expect(keys(issues)).not.toContain("spof:step:b");
  });

  it("counts skills: two people in the role but only one with the skill", () => {
    const m = line(2, [{ id: "a" }], { r: 2 }, {
      people: { ann: person(["r"], { name: "Ann", skills: ["a"] }), bob: person(["r"], { name: "Bob", skills: [] }) },
    });
    expect(find(run(m), "spof:step:a")?.title).toBe("Only Ann can do Step a");
  });

  it("ignores steps nothing reaches and unstaffed steps", () => {
    const m = line(2, [{ id: "a", role: null, work: 0 }, { id: "b", role: "solo" }], { solo: 1 });
    m.steps[0]!.next = [{ to: "won", p: 1 }];
    expect(keys(run(m)).filter((k) => k.startsWith("spof"))).toEqual([]);
  });
});

describe("rework over threshold", () => {
  it("flags 30% rework as a warning, 45% as serious, and leaves 10% alone", () => {
    const m = line(2, [{ id: "a", rework: 0.3 }, { id: "b", rework: 0.45 }, { id: "c", rework: 0.1 }], { r: 3 });
    const issues = run(m);
    expect(find(issues, "rework:step:a")).toMatchObject({ type: "failure", severity: "warning", title: "30% of Step a is done twice" });
    expect(find(issues, "rework:step:b")?.severity).toBe("serious");
    expect(keys(issues)).not.toContain("rework:step:c");
    expect(find(issues, "rework:step:a")?.fix?.patch).toEqual([{ path: "steps.a.rework_rate", op: "multiply", value: 0.5 }]);
    // Observed share of visits that were repeats is close to the model's 30%.
    expect(find(issues, "rework:step:a")!.metrics.observed_share).toBeGreaterThan(0.2);
    expect(find(issues, "rework:step:a")!.metrics.observed_share).toBeLessThan(0.4);
    fixesApply(m, issues);
  });
});

describe("SLA breach", () => {
  it("flags every visit breaching a 2 h SLA on a 3 h constant step, and none under a 5 h one", () => {
    const m = line(2, [{ id: "a", work: 3, sla: 2 }, { id: "b", work: 3, sla: 5 }], { r: 2 });
    const r = simulate(m, 12, 1);
    expect(r.steps.a!.slaBreaches).toBe(r.steps.a!.departures);
    const issues = detectIssues(m, r);
    const issue = find(issues, "sla:step:a")!;
    expect(issue).toMatchObject({ type: "sla", severity: "critical", title: "Step a misses its 2 h SLA 100% of the time" });
    expect(issue.metrics.breach_share).toBe(1);
    expect(keys(issues)).not.toContain("sla:step:b");
  });

  it("suggests halving the external wait when that, not the queue, breaks the SLA", () => {
    const m = line(2, [{ id: "a", work: 1, wait: 20, waitDist: { kind: "constant" }, sla: 8 }], { r: 2 });
    const issue = find(run(m), "sla:step:a")!;
    expect(issue.fix?.patch).toEqual([{ path: "steps.a.wait_hours", op: "multiply", value: 0.5 }]);
  });

  it("counts no breaches when a step has no SLA", () => {
    const r = simulate(line(2, [{ id: "a", work: 3 }]), 4, 1);
    expect(r.steps.a!.slaBreaches).toBe(0);
    expect(r.steps.a!.departures).toBeGreaterThan(0);
  });
});

describe("Northbeam", () => {
  it("as seeded: the strategist is the only one who can do audits and kickoffs, at ~80%", () => {
    const m = northbeamModel();
    const issues = run(m, 30);
    expect(keys(issues)).toEqual(["spof:step:audit", "spof:step:kickoff"]);
    expect(issues[0]!.title).toBe("Only one Strategist can do Audit & proposal");
    expect(issues[0]!.fix?.name).toBe("Hire another Strategist");
    fixesApply(m, issues);
  });

  it("with 80% more leads: the audit queue grows, the strategist is over 85%, kickoffs wait", () => {
    const m = northbeamModel();
    m.leadsPerWeek *= 1.8;
    const issues = run(m, 30);
    expect(keys(issues)).toEqual([
      "queue:step:audit",
      "wait:step:kickoff",
      "capacity:role:strat",
      "spof:step:audit",
      "spof:step:kickoff",
    ]);
    // Severity order: critical first.
    expect(issues.map((i) => i.severity)).toEqual(["critical", "critical", "serious", "serious", "serious"]);
    // The suggested fix clears the growing queue.
    const fixed = applyPatches(m, find(issues, "queue:step:audit")!.fix!.patch).model;
    expect(keys(run(fixed, 30))).not.toContain("queue:step:audit");
  });
});

describe("stable keys", () => {
  it("an unchanged model gives identical issues run after run", () => {
    const m = northbeamModel();
    m.leadsPerWeek *= 1.8;
    expect(detectIssues(m, simulate(m, 30, 1))).toEqual(detectIssues(m, simulate(m, 30, 1)));
  });

  it("keys name the subject, not the numbers: another seed gives the same keys", () => {
    const m = northbeamModel();
    m.leadsPerWeek *= 1.8;
    expect(keys(detectIssues(m, simulate(m, 30, 99)))).toEqual(keys(detectIssues(m, simulate(m, 30, 1))));
  });

  it("is a pure function: the model and result are not changed", () => {
    const m = northbeamModel();
    const r = simulate(m, 5, 1);
    const before = JSON.stringify([m, r]);
    detectIssues(m, r);
    expect(JSON.stringify([m, r])).toBe(before);
  });
});
