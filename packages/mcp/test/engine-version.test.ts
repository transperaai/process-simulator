import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, northbeamModel, simulate } from "@transpera-flow/engine";
import { summarizeRun } from "../src";

// Every run the MCP server reports says which engine produced it (docs/PRD.md
// §6.9; issue #22), as a saved run records it.
describe("engine version in MCP results", () => {
  it("run_scenario's summary carries the engine version", () => {
    const model = northbeamModel();
    expect(summarizeRun(model, simulate(model, 2, 1)).engine_version).toBe(ENGINE_VERSION);
  });
});
