"use server";

import { CHURN_DRIVER_SPECS, CUSTOM_DRIVER_VALUE, type BuiltinChurnDriverId } from "@transpera-flow/engine";
import { MAX_CUSTOM_DRIVERS, NEW_DRIVER_NAME, parseDriverPatch } from "@/lib/churn-drivers";
import { isId } from "@/lib/services";
import { createClient } from "@/lib/supabase/server";

// Writes from Settings, Churn drivers (A56). Every write runs as the signed-in user through RLS: owners and
// editors write, everyone else is refused; these checks only reject malformed input early. A driver is saved as a
// whole row (the last save wins, as for market conditions), and a built-in's row is created the first time it is
// changed: until then it is at its default.

export type DriverResult = { status: "saved"; rowId: string } | { status: "error"; message: string };

const failed = (error: { code?: string } | null): DriverResult => ({
  status: "error",
  message:
    error?.code === "42501"
      ? "You don't have permission to change this."
      : error?.code === "23514"
        ? "That isn't allowed. A workspace can have up to 25 drivers of its own, and each value has a range."
        : "Couldn't save. Try again.",
});

async function signedIn(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims?.sub);
}

const invalid: DriverResult = { status: "error", message: "That value isn't valid." };
const signedOut: DriverResult = { status: "error", message: "Your session has ended. Sign in again." };

/**
 * Change a driver: `key` is a built-in's key or the id of one of your own. Returns the id of its row, which is
 * new the first time a built-in is changed.
 */
export async function saveChurnDriver(workspaceId: string, key: string, patch: unknown): Promise<DriverResult> {
  const parsed = parseDriverPatch(key, patch);
  if (!isId(workspaceId) || !parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  const supabase = await createClient();

  const update = async (id: string): Promise<DriverResult> => {
    const { data, error } = await supabase.from("churn_drivers").update(parsed).eq("id", id).eq("workspace_id", workspaceId).select("id");
    if (error) return failed(error);
    return data.length ? { status: "saved", rowId: id } : { status: "error", message: "That driver was removed, or you can't change it." };
  };

  if (isId(key)) return update(key);

  const builtin = key as BuiltinChurnDriverId;
  const existing = async () => {
    const { data, error } = await supabase.from("churn_drivers").select("id").eq("workspace_id", workspaceId).eq("driver", builtin).maybeSingle();
    return { id: data?.id ?? null, error };
  };
  const found = await existing();
  if (found.error) return failed(found.error);
  if (found.id) return update(found.id);

  // First change: the row starts from the default for everything the edit doesn't set.
  const spec = CHURN_DRIVER_SPECS[builtin];
  const { data, error } = await supabase
    .from("churn_drivers")
    .insert({
      workspace_id: workspaceId,
      driver: builtin,
      weight: parsed.weight ?? 1,
      enabled: parsed.enabled ?? spec.defaultEnabled,
      value: parsed.value !== undefined ? parsed.value : spec.defaultValue,
      month: builtin === "price" ? (parsed.month ?? 1) : null,
    })
    .select("id")
    .single();
  if (error) {
    // Someone set it up a moment ago: apply this edit to their row.
    if (error.code === "23505") {
      const again = await existing();
      return again.id ? update(again.id) : failed(error);
    }
    return failed(error);
  }
  return { status: "saved", rowId: data.id };
}

/** Add a driver of your own, starting as "New driver" at weight 1 with 20% extra churn; the person renames it. */
export async function addChurnDriver(workspaceId: string): Promise<DriverResult> {
  if (!isId(workspaceId)) return invalid;
  if (!(await signedIn())) return signedOut;
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("churn_drivers")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("driver", null);
  if (countError) return failed(countError);
  if ((count ?? 0) >= MAX_CUSTOM_DRIVERS) return { status: "error", message: `You can have up to ${MAX_CUSTOM_DRIVERS} drivers of your own.` };
  const { data, error } = await supabase
    .from("churn_drivers")
    .insert({ workspace_id: workspaceId, name: NEW_DRIVER_NAME, weight: 1, enabled: true, value: CUSTOM_DRIVER_VALUE.default })
    .select("id")
    .single();
  if (error) return failed(error);
  return { status: "saved", rowId: data.id };
}

/** Remove a driver of your own. */
export async function removeChurnDriver(workspaceId: string, rowId: string): Promise<DriverResult> {
  if (!isId(workspaceId) || !isId(rowId)) return invalid;
  if (!(await signedIn())) return signedOut;
  const supabase = await createClient();
  const { data, error } = await supabase.from("churn_drivers").delete().eq("id", rowId).eq("workspace_id", workspaceId).is("driver", null).select("id");
  if (error) return failed(error);
  return data.length ? { status: "saved", rowId } : { status: "error", message: "That driver was already removed, or you can't change it." };
}
