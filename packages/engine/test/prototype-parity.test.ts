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

/** The prototype leaks its internal `seg` cursor into the trace; the port strips it. */
function normalise(res: SimulationResult): unknown {
  const json = JSON.parse(JSON.stringify(res)) as SimulationResult;
  json.trace?.forEach((e) => delete (e as { seg?: unknown }).seg);
  return json;
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

  for (const seed of [1, 2, 42]) {
    it(`produces identical results at seed ${seed}`, () => {
      const model = northbeamModel();
      expect(normalise(simulate(model, 30, seed))).toEqual(normalise(proto.simulate(model, 30, seed)));
    });
  }

  it("matches the prototype under a scenario (double leads)", () => {
    const model = { ...northbeamModel(), leadsPerWeek: 24 };
    expect(normalise(simulate(model, 30, 1))).toEqual(normalise(proto.simulate(model, 30, 1)));
  });
});
