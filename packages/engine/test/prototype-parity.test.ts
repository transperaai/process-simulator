import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { northbeamModel, simulate, type EngineModel, type SimulationResult } from "../src";

// Load the prototype's engine straight out of the HTML file and run it in a
// sandbox, so the port is checked against the real thing, not a transcription.
const html = readFileSync(
  fileURLToPath(new URL("../../../prototype/northbeam-process-simulator.html", import.meta.url)),
  "utf8",
);

type PrototypeSim = { simulate: (m: EngineModel, reps: number, seed: number) => SimulationResult };

function prototypeScript(): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Prototype script not found");
  return m[1]!;
}

function loadPrototypeEngine(): PrototypeSim {
  const src = prototypeScript();
  const start = src.indexOf("(function (root)");
  const endMarker = "})(typeof window !== 'undefined' ? window : globalThis);";
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0) throw new Error("Prototype engine IIFE not found");
  const sandbox: Record<string, unknown> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src.slice(start, end + endMarker.length), sandbox);
  return sandbox.ProcessSim as PrototypeSim;
}

function prototypeBaseModel(): EngineModel {
  const src = prototypeScript();
  const start = src.indexOf("const BASE_MODEL");
  if (start < 0) throw new Error("Prototype BASE_MODEL not found");
  const decl = src.slice(start, src.indexOf("\n};", start) + 3);
  return vm.runInNewContext(`${decl}; BASE_MODEL`) as EngineModel;
}

describe("port parity with the prototype engine", () => {
  const proto = loadPrototypeEngine();

  it("fixture matches the prototype's BASE_MODEL", () => {
    const base = prototypeBaseModel();
    const ours = northbeamModel();
    expect(ours.steps.map(({ id, role, work, wait, rework, next }) => ({ id, role, work, wait, rework, next }))).toEqual(
      base.steps.map(({ id, role, work, wait, rework, next }) => ({ id, role, work, wait, rework, next })),
    );
    expect(ours.roles).toEqual(base.roles);
    expect({ ...ours, steps: undefined, roles: undefined }).toMatchObject({
      horizonWeeks: base.horizonWeeks,
      hoursPerWeek: base.hoursPerWeek,
      leadsPerWeek: base.leadsPerWeek,
      activeClients: base.activeClients,
      churnMonthly: base.churnMonthly,
      retainer: base.retainer,
      entry: base.entry,
      sinks: base.sinks,
    });
  });

  // The port draws random numbers from separate streams per purpose, so single
  // runs differ from the prototype; across many replications the results must
  // agree. Fixed seeds keep this deterministic (no flakiness).
  const REPS = 300;
  for (const [label, leads] of [["baseline", 12], ["double leads", 24]] as const) {
    it(`agrees statistically with the prototype (${label})`, () => {
      const model = { ...northbeamModel(), leadsPerWeek: leads };
      const ours = simulate(model, REPS, 1);
      const theirs = proto.simulate(model, REPS, 1);
      const rel = (a: number, b: number) => Math.abs(a - b) / b;
      expect(rel(ours.won, theirs.won)).toBeLessThan(0.1);
      expect(rel(ours.lost, theirs.lost)).toBeLessThan(0.03);
      expect(Math.abs(ours.roles.strat!.util - theirs.roles.strat!.util)).toBeLessThan(0.01);
      expect(rel(ours.cycleP50, theirs.cycleP50)).toBeLessThan(0.05);
      expect(rel(ours.cycleP90, theirs.cycleP90)).toBeLessThan(0.05);
      expect(ours.bnRole).toBe(theirs.bnRole);
      expect(ours.bnStep).toBe(theirs.bnStep);
    });
  }
});
