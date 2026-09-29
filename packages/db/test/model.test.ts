import { describe, expect, it } from "vitest";
import { northbeamModel, simulate, type EngineModel } from "@flowsim/engine";
import {
  ModelError,
  northbeamBundle,
  northbeamPersonIds,
  northbeamRoleIds,
  northbeamStepIds,
  toEngineModel,
  workingDaysBetween,
} from "../src";

/** Swap fixture uuids back to the prototype's readable keys. */
function withKeys(model: EngineModel): EngineModel {
  const names = new Map<string, string>([
    ...Object.entries(northbeamStepIds).map(([k, v]) => [v, k] as const),
    ...Object.entries(northbeamRoleIds).map(([k, v]) => [v, k] as const),
  ]);
  const key = (id: string) => names.get(id) ?? id;
  return {
    ...model,
    entry: key(model.entry),
    sinks: { won: key(model.sinks.won), lost: key(model.sinks.lost) },
    roles: Object.fromEntries(Object.entries(model.roles).map(([id, r]) => [key(id), r])),
    steps: model.steps.map((s) => ({
      ...s,
      id: key(s.id),
      role: s.role && key(s.role),
      next: s.next.map((n) => ({ ...n, to: key(n.to) })),
    })),
  };
}

const START = "2026-10-05"; // a Monday

describe("toEngineModel", () => {
  it("resolves the Northbeam rows into exactly the prototype model (plus named people)", () => {
    const { people, ...model } = withKeys(toEngineModel(northbeamBundle(), { startDate: START }));
    expect(model).toEqual(northbeamModel());
    expect(Object.keys(people!)).toHaveLength(11);
  });

  it("simulates to the prototype's headline result: strategist is the ~91% bottleneck", () => {
    // Random streams are keyed by step id, so uuid-keyed rows and the
    // prototype's name-keyed model draw different (equally valid) samples;
    // exact equality of the models is covered above.
    const res = simulate(toEngineModel(northbeamBundle(), { startDate: START }), 300, 1);
    const reference = simulate(northbeamModel(), 300, 1);
    expect(res.bnRole).toBe(northbeamRoleIds.strat);
    expect(res.roles[northbeamRoleIds.strat]!.util).toBeCloseTo(reference.roles.strat!.util, 2);
    expect(Math.abs(res.won - reference.won) / reference.won).toBeLessThan(0.1);
  });

  it("does not depend on row order", () => {
    const shuffled = northbeamBundle();
    shuffled.steps.reverse();
    shuffled.edges.reverse();
    shuffled.roles.reverse();
    shuffled.people.reverse();
    shuffled.personRoles.reverse();
    expect(toEngineModel(shuffled, { startDate: START })).toEqual(toEngineModel(northbeamBundle(), { startDate: START }));
  });

  it("rejects a process without a start step", () => {
    const b = northbeamBundle();
    b.steps = b.steps.filter((s) => s.kind !== "start");
    expect(() => toEngineModel(b)).toThrow(ModelError);
  });

  it("rejects a working step with no way out", () => {
    const b = northbeamBundle();
    b.edges = b.edges.filter((e) => e.from_step_id !== northbeamStepIds.audit);
    expect(() => toEngineModel(b)).toThrow(/no outgoing edge/);
  });
});

describe("people", () => {
  const maya = northbeamPersonIds["Maya Collins"]!;
  const priya = northbeamPersonIds["Priya Shah"]!;

  it("maps each person to their roles and full-time capacity", () => {
    const people = toEngineModel(northbeamBundle(), { startDate: START }).people!;
    expect(people[maya]).toEqual({ name: "Maya Collins", roles: [northbeamRoleIds.strat], capacity: 40 });
    const perRole = Object.values(people).reduce<Record<string, number>>((acc, p) => {
      for (const r of p.roles) acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    for (const role of northbeamBundle().roles) expect(perRole[role.id]).toBe(role.headcount);
  });

  it("derives capacity from FTE unless hours are set", () => {
    const b = northbeamBundle();
    b.people = b.people.map((p) => (p.id === maya ? { ...p, fte: 0.6 } : p.id === priya ? { ...p, capacity_hours_week: 30 } : p));
    const people = toEngineModel(b, { startDate: START }).people!;
    expect(people[maya]!.capacity).toBe(24);
    expect(people[priya]!.capacity).toBe(30);
  });

  it("leaves out inactive people and anyone not employed on the start date", () => {
    const b = northbeamBundle();
    const [a, c, d] = [priya, northbeamPersonIds["Tom Reed"]!, northbeamPersonIds["Rosa Diaz"]!];
    b.people = b.people.map((p) =>
      p.id === a ? { ...p, active: false } : p.id === c ? { ...p, start_date: "2026-11-01" } : p.id === d ? { ...p, end_date: "2026-10-01" } : p,
    );
    const people = toEngineModel(b, { startDate: START }).people!;
    expect(Object.keys(people)).toHaveLength(8);
    expect(people[a] ?? people[c] ?? people[d]).toBeUndefined();
  });

  it("falls back to role head-counts when the workspace has no people", () => {
    const b = northbeamBundle();
    b.people = [];
    expect(toEngineModel(b, { startDate: START }).people).toBeUndefined();
  });

  it("converts leave dates to working hours from the start date", () => {
    expect(workingDaysBetween("2026-10-05", "2026-10-12")).toBe(5);
    expect(workingDaysBetween("2026-10-05", "2026-10-05")).toBe(0);
    const b = northbeamBundle();
    // Thursday to the following Tuesday inclusive: 4 working days, starting 3 working days in.
    b.personLeave = [{ id: "l1", person_id: maya, workspace_id: b.workspace.id, start_date: "2026-10-08", end_date: "2026-10-13" }];
    expect(toEngineModel(b, { startDate: START }).people![maya]!.leave).toEqual([[24, 56]]);
  });

  it("clips leave that started before the run and drops leave that already ended", () => {
    const b = northbeamBundle();
    b.personLeave = [
      { id: "l1", person_id: maya, workspace_id: b.workspace.id, start_date: "2026-09-28", end_date: "2026-10-06" },
      { id: "l2", person_id: maya, workspace_id: b.workspace.id, start_date: "2026-09-01", end_date: "2026-09-02" },
    ];
    expect(toEngineModel(b, { startDate: START }).people![maya]!.leave).toEqual([[0, 16]]);
  });

  it("limits skills to this process's steps", () => {
    const b = northbeamBundle();
    b.personSkills = [
      { person_id: priya, step_id: northbeamStepIds.discovery, workspace_id: b.workspace.id },
      { person_id: priya, step_id: "00000000-0000-4000-8000-00000000ffff", workspace_id: b.workspace.id },
    ];
    expect(toEngineModel(b, { startDate: START }).people![priya]!.skills).toEqual([northbeamStepIds.discovery]);
  });

  it("passes a step's pinned person and the workspace availability floor to the engine", () => {
    const b = northbeamBundle();
    b.steps = b.steps.map((st) => (st.id === northbeamStepIds.audit ? { ...st, person_id: maya } : st));
    b.workspace.settings = { ...b.workspace.settings, availability_floor: 0.12 };
    const model = toEngineModel(b, { startDate: START });
    expect(model.steps.find((st) => st.id === northbeamStepIds.audit)!.person).toBe(maya);
    expect(model.availabilityFloor).toBe(0.12);
  });
});
