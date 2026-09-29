"use server";

import { saveFields } from "@/lib/fields/server";
import type { UpdateResult, WriteResult } from "@/lib/editor/store";
import { parseFieldUpdate, parseIds, parseNewEdge, parseNewStep, isId } from "@/lib/editor/validate";
import { createClient } from "@/lib/supabase/server";

// Writes from the process editor (issue #8). Every write runs as the signed-in
// user through RLS; the checks in lib/editor/validate.ts only reject malformed
// input early. Field updates are per-field compare-and-set
// (docs/adr/0001-per-field-saves.md); creates and deletes are plain inserts and
// deletes. Nothing here refreshes the page: the editor already shows the edit.

const invalid = { status: "error", message: "That change isn't valid." } as const;
const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to edit this process." } as const;

/** The revision if the signed-in user can edit it: its workspace and process come from the database, not the client. */
async function editableRevision(revisionId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { ok: false, error: signedOut } as const;
  const { data: revision, error } = await supabase
    .from("process_revisions")
    .select("id, workspace_id, process_id")
    .eq("id", revisionId)
    .maybeSingle();
  if (error || !revision) return { ok: false, error: forbidden } as const;
  const { data: canEdit } = await supabase.rpc("can_edit_workspace", { ws: revision.workspace_id });
  if (canEdit !== true) return { ok: false, error: forbidden } as const;
  return { ok: true, supabase, revision } as const;
}

const failure = (error: { code?: string }): WriteResult =>
  error.code === "42501"
    ? forbidden
    : error.code === "23514"
      ? { status: "error", message: "Some of those values aren't allowed." }
      : error.code === "23503"
        ? { status: "error", message: "That refers to something that no longer exists." }
        : { status: "error", message: "Couldn't save. Try again." };

/** Save fields of one step or edge if each is still what the editor last saw. */
export async function saveProcessFields(
  revisionId: string,
  table: unknown,
  id: string,
  base: unknown,
  changes: unknown,
): Promise<UpdateResult> {
  const parsed = parseFieldUpdate(table, base, changes);
  if (!isId(revisionId) || !isId(id) || !parsed) return invalid;
  const access = await editableRevision(revisionId);
  if (!access.ok) return access.error;
  return saveFields(parsed.table, { revision_id: revisionId, id }, parsed.base, parsed.changes);
}

/** Insert new (or restored) steps, then edges, into the revision. */
export async function insertProcessRows(revisionId: string, steps: unknown, edges: unknown): Promise<WriteResult> {
  if (!isId(revisionId) || !Array.isArray(steps) || !Array.isArray(edges) || steps.length + edges.length > 500) return invalid;
  const newSteps = steps.map(parseNewStep);
  const newEdges = edges.map(parseNewEdge);
  if (newSteps.some((s) => !s) || newEdges.some((e) => !e)) return invalid;
  const access = await editableRevision(revisionId);
  if (!access.ok) return access.error;
  const { supabase, revision } = access;
  const owner = { revision_id: revision.id, workspace_id: revision.workspace_id, process_id: revision.process_id };
  if (newSteps.length) {
    const { error } = await supabase.from("steps").insert(newSteps.map((s) => ({ ...s!, ...owner })));
    if (error) return failure(error);
  }
  if (newEdges.length) {
    const { error } = await supabase.from("edges").insert(newEdges.map((e) => ({ ...e!, ...owner })));
    if (error) return failure(error);
  }
  return { status: "ok" };
}

/** Delete edges, then steps (whose remaining edges go with them). Rows already gone are fine. */
export async function deleteProcessRows(revisionId: string, stepIds: unknown, edgeIds: unknown): Promise<WriteResult> {
  const steps = parseIds(stepIds);
  const edges = parseIds(edgeIds);
  if (!isId(revisionId) || !steps || !edges) return invalid;
  const access = await editableRevision(revisionId);
  if (!access.ok) return access.error;
  const { supabase } = access;
  if (edges.length) {
    const { error } = await supabase.from("edges").delete().eq("revision_id", revisionId).in("id", edges);
    if (error) return failure(error);
  }
  if (steps.length) {
    const { error } = await supabase.from("steps").delete().eq("revision_id", revisionId).in("id", steps);
    if (error) return failure(error);
  }
  return { status: "ok" };
}
