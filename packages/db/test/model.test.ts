import { describe, expect, it } from "vitest";
import { northbeamModel, simulate, type EngineModel } from "@flowsim/engine";
import { ModelError, northbeamBundle, northbeamRoleIds, northbeamStepIds, toEngineModel } from "../src";

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

describe("toEngineModel", () => {
  it("resolves the Northbeam rows into exactly the prototype model", () => {
    expect(withKeys(toEngineModel(northbeamBundle()))).toEqual(northbeamModel());
  });

  it("simulates to the prototype's headline result: strategist is the ~91% bottleneck", () => {
    // Random streams are keyed by step id, so uuid-keyed rows and the
    // prototype's name-keyed model draw different (equally valid) samples;
    // exact equality of the models is covered above.
    const res = simulate(toEngineModel(northbeamBundle()), 300, 1);
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
    expect(toEngineModel(shuffled)).toEqual(toEngineModel(northbeamBundle()));
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
