// Where saved scenarios go. `live` (./live-store.ts) calls Server Actions that
// write to the database as the signed-in user; `MemoryScenarioStore` keeps
// them in memory for the public demo (lost on reload) and for tests.

import type { ScenarioRow } from "@transpera-flow/db";
import { parseScenarioInput, type ScenarioInput } from "./validate";

export type SaveScenarioResult = { status: "ok"; scenario: ScenarioRow } | { status: "error"; message: string };
export type RemoveScenarioResult = { status: "ok" } | { status: "error"; message: string };

export interface ScenarioStore {
  create(input: ScenarioInput): Promise<SaveScenarioResult>;
  remove(id: string): Promise<RemoveScenarioResult>;
}

export class MemoryScenarioStore implements ScenarioStore {
  constructor(private readonly workspaceId: string) {}

  async create(input: ScenarioInput): Promise<SaveScenarioResult> {
    const parsed = parseScenarioInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    return { status: "ok", scenario: { id: crypto.randomUUID(), workspace_id: this.workspaceId, ...parsed.value } };
  }

  async remove(): Promise<RemoveScenarioResult> {
    return { status: "ok" };
  }
}
