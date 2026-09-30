"use server";

import { SOURCE_COLUMNS, type SourceRow } from "@transpera-flow/db";
import { mapOutcome, type SaveOutcome } from "@/lib/fields/field-controller";
import { saveField } from "@/lib/fields/server";
import type { RemoveSourceResult, SaveSourceResult } from "@/lib/sources/store";
import { cleanSourceField, formatSpeakers, isId, isSourceField, parseSourceInput, parseSpeakers, type Scalar } from "@/lib/sources/validate";
import { createClient } from "@/lib/supabase/server";

// Adding, editing and deleting sources (issue #21). Every write runs as the
// signed-in user through RLS (editors, owners and agency admins may write;
// everyone in the workspace may read). The checks in lib/sources/validate.ts
// only reject malformed input early; the table checks them again. Edits are
// per-field saves (docs/adr/0001-per-field-saves.md).

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to change sources here." } as const;
const invalid = { status: "error", message: "That source isn't valid." } as const;

async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

const failure = (error: { code?: string }) =>
  error.code === "42501"
    ? forbidden
    : error.code === "23514"
      ? ({ status: "error", message: "Some of those values aren't allowed." } as const)
      : ({ status: "error", message: "Couldn't save. Try again." } as const);

/** Add a source (a transcript, notes or a screenshot link). */
export async function createSource(workspaceId: unknown, input: unknown): Promise<SaveSourceResult> {
  if (!isId(workspaceId)) return invalid;
  const parsed = parseSourceInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { data, error } = await supabase
    .from("sources")
    .insert({ ...parsed.value, workspace_id: workspaceId })
    .select(SOURCE_COLUMNS)
    .single();
  if (error) return failure(error);
  return { status: "ok", source: data as unknown as SourceRow };
}

/** Save one field of a source if its stored value is still `base`. Speakers travel as "a, b" text. */
export async function saveSourceField(id: unknown, field: unknown, base: unknown, value: unknown): Promise<SaveOutcome<Scalar>> {
  if (!isId(id) || !isSourceField(field)) return invalid;
  const clean = cleanSourceField(field, value);
  const isScalar = base === null || ["string", "number", "boolean"].includes(typeof base);
  if (!clean || !isScalar) return { status: "error", message: "That value isn't valid." };
  if (!(await signedInClient())) return signedOut;
  if (field === "speakers") {
    const outcome = await saveField("sources", { id }, field, parseSpeakers(base as string | null), clean.value as string[]);
    return mapOutcome(outcome, (speakers) => formatSpeakers(speakers) || null);
  }
  return saveField("sources", { id }, field, base as Scalar, clean.value as Scalar);
}

/** Delete a source. Values citing it keep their quotes; the Sources page shows them as citing a deleted source. */
export async function deleteSource(id: unknown): Promise<RemoveSourceResult> {
  if (!isId(id)) return invalid;
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { data, error } = await supabase.from("sources").delete().eq("id", id).select("id");
  if (error) return failure(error);
  return data?.length ? { status: "ok" } : forbidden;
}
