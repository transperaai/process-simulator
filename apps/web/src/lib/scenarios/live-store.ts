import { createScenario, deleteScenario } from "@/app/w/[slug]/scenario-actions";
import type { ScenarioStore } from "./store";

/** Saves scenarios to the database through Server Actions, as the signed-in user. */
export function liveScenarioStore(workspaceId: string): ScenarioStore {
  return {
    create: (input) => createScenario(workspaceId, input),
    remove: (id) => deleteScenario(id),
  };
}
