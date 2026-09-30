import { createSource, deleteSource, saveSourceField } from "@/app/w/[slug]/source-actions";
import type { SourceStore } from "./store";

/** Saves sources to the database through Server Actions, as the signed-in user. */
export function liveSourceStore(workspaceId: string): SourceStore {
  return {
    create: (input) => createSource(workspaceId, input),
    saveField: (id, field, base, value) => saveSourceField(id, field, base, value),
    remove: (id) => deleteSource(id),
  };
}
