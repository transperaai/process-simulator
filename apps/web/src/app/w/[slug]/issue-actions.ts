"use server";

import { loadIssue, saveIssue, type IssueLinkRef, type Json } from "@transpera-flow/db";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { saveField } from "@/lib/fields/server";
import { ALREADY_TRACKED, type RemoveIssueResult, type SaveIssueResult } from "@/lib/issues/store";
import { cleanFieldValue, isId, isIssueField, parseIssueInput, parsePromoteInput, parseSaveInput, type Scalar } from "@/lib/issues/validate";
import { createClient } from "@/lib/supabase/server";

// Logging, tracking, editing and deleting issues (issue #17, reworked in #112). Every write runs
// as the signed-in user through RLS (editors, owners and agency admins may
// write; everyone in the workspace may read). The checks in
// lib/issues/validate.ts only reject malformed input early; the database
// checks every enumerated column too. An issue is created or edited through
// `public.save_issue`, which writes it with its links, owners and sources in one
// transaction (one history entry); single fields are per-field saves
// (docs/adr/0001-per-field-saves.md). Nothing here refreshes the page: the
// register already shows the change.

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to change issues here." } as const;
const invalid = { status: "error", message: "That issue isn't valid." } as const;

async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

const failure = (error: { code?: string; message?: string }) =>
  error.code === "42501"
    ? forbidden
    : error.code === "23505"
      ? ({ status: "error", message: ALREADY_TRACKED } as const)
      : error.code === "23514"
        ? ({ status: "error", message: "Some of those values aren't allowed." } as const)
        : error.code === "23503"
          ? ({ status: "error", message: "Something the issue links to no longer exists." } as const)
          : ({ status: "error", message: "Couldn't save. Try again." } as const);

/** What an old-style input says it touches, as links: its step, else its process. */
const linksOf = (row: { process_id?: string | null; step_id?: string | null }): IssueLinkRef[] =>
  row.step_id ? [{ process_id: row.process_id ?? null, step_id: row.step_id }] : row.process_id ? [{ process_id: row.process_id, step_id: null }] : [];

async function write(
  workspaceId: string,
  args: { id?: string; fields: Record<string, Json | undefined>; links?: IssueLinkRef[]; owners?: string[]; sources?: string[] },
): Promise<SaveIssueResult> {
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const saved = await saveIssue(supabase, { workspaceId, ...args });
  if ("error" in saved) return failure(saved.error);
  const issue = await loadIssue(supabase, workspaceId, saved.id);
  return issue ? { status: "ok", issue } : forbidden;
}

/** Log an issue by hand (an audit finding). */
export async function createIssue(workspaceId: unknown, input: unknown): Promise<SaveIssueResult> {
  if (!isId(workspaceId)) return invalid;
  const parsed = parseIssueInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const { process_id, step_id, owner_person_id, ...fields } = parsed.value;
  return write(workspaceId, { fields: { ...fields, source: "manual" }, links: linksOf({ process_id, step_id }), owners: owner_person_id ? [owner_person_id] : [] });
}

/** Track a detected issue. Its key is unique per workspace, so tracking it twice is refused. */
export async function promoteIssue(workspaceId: unknown, input: unknown): Promise<SaveIssueResult> {
  if (!isId(workspaceId)) return invalid;
  const parsed = parsePromoteInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const { process_id, step_id, owner_person_id, evidence_metrics, ...rest } = parsed.value;
  return write(workspaceId, {
    fields: { ...rest, evidence_metrics: evidence_metrics as Json, source: "promoted", status: rest.status ?? "open" },
    links: linksOf({ process_id, step_id }),
    owners: owner_person_id ? [owner_person_id] : [],
  });
}

/**
 * The Acknowledge dialog (new issue, acknowledge an insight, edit): creates or edits an issue with what it touches,
 * its owners and its sources in one transaction, so the history gets one entry.
 */
export async function saveIssueFromDialog(workspaceId: unknown, input: unknown): Promise<SaveIssueResult> {
  if (!isId(workspaceId)) return invalid;
  const parsed = parseSaveInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const v = parsed.value;
  const fields: Record<string, Json | undefined> = {
    title: v.title,
    severity: v.severity,
    evidence: v.evidence ?? null,
    target_measure: v.target_measure,
    target_now: v.target_now,
    target_goal: v.target_goal,
  };
  if (v.id) {
    if (v.status) fields.status = v.status;
  } else {
    fields.type = v.type ?? "manual";
    if (v.from) {
      const { evidence_metrics, ...from } = v.from;
      Object.assign(fields, from, { evidence_metrics: evidence_metrics as Json, source: "promoted" });
    } else {
      fields.source = "manual";
    }
  }
  return write(workspaceId, { id: v.id, fields, links: v.links, owners: v.owner_ids, sources: v.source_ids });
}

/** Save one field of an issue if its stored value is still `base`. */
export async function saveIssueField(id: unknown, field: unknown, base: unknown, value: unknown): Promise<SaveOutcome<Scalar>> {
  if (!isId(id) || !isIssueField(field)) return invalid;
  const clean = cleanFieldValue(field, value);
  const isScalar = base === null || ["string", "number", "boolean"].includes(typeof base);
  if (!clean || !isScalar) return { status: "error", message: "That value isn't valid." };
  if (!(await signedInClient())) return signedOut;
  return saveField("issues", { id }, field, base as Scalar, clean.value);
}

/** Delete an issue. A row that is gone, or that the user may not delete, reads as forbidden. */
export async function deleteIssue(id: unknown): Promise<RemoveIssueResult> {
  if (!isId(id)) return invalid;
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { data, error } = await supabase.from("issues").delete().eq("id", id).select("id");
  if (error) return failure(error);
  if (!data.length) return forbidden;
  return { status: "ok" };
}
