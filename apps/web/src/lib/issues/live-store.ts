import { createIssue, deleteIssue, promoteIssue, saveIssueField } from "@/app/w/[slug]/issue-actions";
import type { IssueStore } from "./store";

/** Saves issues to the database through Server Actions, as the signed-in user. */
export function liveIssueStore(workspaceId: string): IssueStore {
  return {
    create: (input) => createIssue(workspaceId, input),
    promote: (input) => promoteIssue(workspaceId, input),
    saveField: (id, field, base, value) => saveIssueField(id, field, base, value),
    remove: (id) => deleteIssue(id),
  };
}
