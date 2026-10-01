"use server";

import { isId } from "@/lib/editor/validate";
import { loadVersionModel, type ModelEntry } from "@/lib/history/data";
import { createClient } from "@/lib/supabase/server";

// Writes and reads of the History screen (issue #105). Every call runs as the signed-in user through RLS: the
// database functions (restore_version, duplicate_version) decide who may do what, and say "not_found" for a
// process or version the caller can't edit. The checks here only reject malformed input early.

export type RestoreResult =
  | { status: "restored"; number: number; unlinkedChildren: number }
  /** The draft has changes of its own; restoring would replace them. Ask, then call again with `replaceDraft`. */
  | { status: "draft_exists" }
  | { status: "error"; message: string };

export type DuplicateResult = { status: "duplicated"; processId: string } | { status: "error"; message: string };

const invalid = { status: "error", message: "That isn't a valid version." } as const;
const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to change this process." } as const;
const failed = { status: "error", message: "Couldn't do that. Try again." } as const;

async function signedIn() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? ({ ok: true, supabase } as const) : ({ ok: false } as const);
}

/** Copy a published version into the process's draft. Live is unchanged until the draft is published. */
export async function restoreVersion(processId: string, revisionId: string, replaceDraft: unknown): Promise<RestoreResult> {
  if (!isId(processId) || !isId(revisionId) || typeof replaceDraft !== "boolean") return invalid;
  const session = await signedIn();
  if (!session.ok) return signedOut;
  const { data, error } = await session.supabase.rpc("restore_version", { target_process: processId, source_revision: revisionId, replace_draft: replaceDraft });
  if (error) return error.code === "42501" ? forbidden : failed;
  const r = data as { status: string; number?: number; unlinked_children?: number };
  if (r.status === "restored") return { status: "restored", number: r.number ?? 0, unlinkedChildren: r.unlinked_children ?? 0 };
  if (r.status === "draft_exists") return { status: "draft_exists" };
  if (r.status === "already_live") return { status: "error", message: "That is the live version already." };
  return forbidden;
}

const MAX_NAME = 120;

/** Start a new process from a published version. */
export async function duplicateVersion(processId: string, revisionId: string, name: unknown): Promise<DuplicateResult> {
  if (!isId(processId) || !isId(revisionId)) return invalid;
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean || clean.length > MAX_NAME) return { status: "error", message: `Give it a name (up to ${MAX_NAME} characters).` };
  const session = await signedIn();
  if (!session.ok) return signedOut;
  // The version must belong to the process on this page, so a stale link can't copy something else.
  const { data: revision } = await session.supabase.from("process_revisions").select("process_id").eq("id", revisionId).maybeSingle();
  if (!revision || revision.process_id !== processId) return invalid;
  const { data, error } = await session.supabase.rpc("duplicate_version", { source_revision: revisionId, new_name: clean });
  if (error) return error.code === "42501" ? forbidden : failed;
  const r = data as { status: string; process_id?: string };
  if (r.status === "duplicated" && r.process_id) return { status: "duplicated", processId: r.process_id };
  if (r.status === "name_taken") return { status: "error", message: `There is already a process called '${clean}'.` };
  if (r.status === "invalid_name") return { status: "error", message: `Give it a name (up to ${MAX_NAME} characters).` };
  return forbidden;
}

/** The model of an older version, to simulate it when someone presses Run. */
export async function versionModel(processId: string, revisionId: string): Promise<ModelEntry | { error: string }> {
  if (!isId(processId) || !isId(revisionId)) return { error: invalid.message };
  const session = await signedIn();
  if (!session.ok) return { error: signedOut.message };
  try {
    return (await loadVersionModel(processId, revisionId)) ?? { error: "That version isn't available." };
  } catch {
    return { error: failed.message };
  }
}
