"use server";

import { SCENARIO_COLUMNS, type Json, type ScenarioRow } from "@transpera-flow/db";
import { parsePatches } from "@transpera-flow/engine";
import { isId, parseScenarioInput } from "@/lib/scenarios/validate";
import type { RemoveScenarioResult, SaveScenarioResult } from "@/lib/scenarios/store";
import { createClient } from "@/lib/supabase/server";

// Saving and deleting scenarios (issue #15). Every write runs as the signed-in
// user through RLS (editors, owners and agency admins may write; everyone in
// the workspace may read and apply). The checks in lib/scenarios/validate.ts
// only reject malformed input early; the database checks the patch shape too.
// Nothing here refreshes the page: the panel already shows the change.

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to change scenarios here." } as const;

async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

const failure = (error: { code?: string }) =>
  error.code === "42501"
    ? forbidden
    : error.code === "23514"
      ? ({ status: "error", message: "Some of those changes aren't allowed." } as const)
      : error.code === "23503"
        ? ({ status: "error", message: "The scenario you copied no longer exists." } as const)
        : ({ status: "error", message: "Couldn't save. Try again." } as const);

/** Save a new scenario (from the levers, or a duplicate) in the workspace. */
export async function createScenario(workspaceId: unknown, input: unknown): Promise<SaveScenarioResult> {
  if (!isId(workspaceId)) return { status: "error", message: "That scenario isn't valid." };
  const parsed = parseScenarioInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { patch, ...rest } = parsed.value;
  const { data, error } = await supabase
    .from("scenarios")
    .insert({ ...rest, patch: patch as unknown as Json, workspace_id: workspaceId })
    .select(SCENARIO_COLUMNS)
    .single();
  if (error) return failure(error);
  return { status: "ok", scenario: data as unknown as ScenarioRow };
}

/** Delete a scenario. A row that is gone, or that the user may not delete, reads as forbidden. */
export async function deleteScenario(id: unknown): Promise<RemoveScenarioResult> {
  if (!isId(id)) return { status: "error", message: "That scenario isn't valid." };
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { data, error } = await supabase.from("scenarios").delete().eq("id", id).select("id");
  if (error) return failure(error);
  if (!data.length) return forbidden;
  return { status: "ok" };
}

/**
 * Replace a scenario's patches (issue #16: re-pointing a change whose step was
 * split or deleted). Last write wins, like the rest of a scenario's row; RLS
 * decides who may. A row that is gone, or that the user may not change, reads
 * as forbidden.
 */
export async function updateScenarioPatch(id: unknown, patch: unknown): Promise<SaveScenarioResult> {
  if (!isId(id)) return { status: "error", message: "That scenario isn't valid." };
  const parsed = parsePatches(patch);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  if (!parsed.patches.length) return { status: "error", message: "A scenario needs at least one change." };
  const supabase = await signedInClient();
  if (!supabase) return signedOut;
  const { data, error } = await supabase
    .from("scenarios")
    .update({ patch: parsed.patches as unknown as Json })
    .eq("id", id)
    .select(SCENARIO_COLUMNS);
  if (error) return failure(error);
  if (!data.length) return forbidden;
  return { status: "ok", scenario: data[0] as unknown as ScenarioRow };
}
