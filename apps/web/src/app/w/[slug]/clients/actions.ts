"use server";

import { refresh } from "next/cache";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { saveField, saveLinks } from "@/lib/fields/server";
import { checkNewClient, isId, MAX_IMPORT, newClientProvenance, parseClientField, type NewClient } from "@/lib/clients/roster";
import { createClient as createSupabase } from "@/lib/supabase/server";

// Writes from the Clients page (issue #18). Every write runs as the signed-in
// user through RLS; these checks only reject malformed input early.

type Scalar = string | number | boolean | null;

export interface ActionResult {
  error?: string;
  /** Clients added by an import. */
  created?: number;
}

const invalid = { status: "error", message: "That value isn't valid." } as const;
const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;

async function signedIn(): Promise<boolean> {
  const supabase = await createSupabase();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims?.sub);
}

const failure = (error: { code?: string } | null): ActionResult =>
  error?.code === "42501"
    ? { error: "You don't have permission to do that." }
    : error?.code === "23514"
      ? { error: "Some of those values aren't allowed." }
      : error?.code === "23503"
        ? { error: "A service or person in that list no longer exists. Reload and try again." }
        : { error: "Couldn't save. Try again." };

export async function saveClientField(clientId: string, field: string, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
  const parsed = parseClientField(clientId, field, base, value);
  if (!parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  return refreshed(await saveField("clients", { id: parsed.clientId }, parsed.field, parsed.base, parsed.value));
}

/** Refresh the page's derived figures (loads, totals) once a save lands. */
function refreshed<T extends SaveOutcome<Scalar> | SaveOutcome<string[]> | SaveOutcome<string | null>>(outcome: T): T {
  if (outcome.status === "saved") refresh();
  return outcome;
}

/** A client's services, saved as one set (like a person's roles). */
export async function saveClientServices(
  clientId: string,
  workspaceId: string,
  base: readonly string[],
  next: readonly string[],
): Promise<SaveOutcome<string[]>> {
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 50 && v.every(isId);
  if (!isId(clientId) || !isId(workspaceId) || !ids(base) || !ids(next)) return invalid;
  if (!(await signedIn())) return signedOut;
  return refreshed(await saveLinks("client_services", { client_id: clientId, workspace_id: workspaceId }, base, next));
}

/**
 * Who looks after a client for a role, if it is still `base` (null: nobody,
 * so the role's people share it). Assigning inserts the row, unassigning
 * deletes it, and reassigning is a per-field save of its person.
 */
export async function saveClientAssignment(
  clientId: string,
  workspaceId: string,
  roleId: string,
  base: string | null,
  next: string | null,
): Promise<SaveOutcome<string | null>> {
  return refreshed(await assign(clientId, workspaceId, roleId, base, next));
}

async function assign(
  clientId: string,
  workspaceId: string,
  roleId: string,
  base: string | null,
  next: string | null,
): Promise<SaveOutcome<string | null>> {
  const person = (v: unknown) => v === null || isId(v);
  if (!isId(clientId) || !isId(workspaceId) || !isId(roleId) || !person(base) || !person(next)) return invalid;
  if (!(await signedIn())) return signedOut;
  if (base === next) return { status: "saved", value: next };
  const supabase = await createSupabase();
  const stored = async (): Promise<string | null> => {
    const { data } = await supabase.from("client_assignments").select("person_id").eq("client_id", clientId).eq("role_id", roleId).maybeSingle();
    return data?.person_id ?? null;
  };
  if (base !== null && next !== null) {
    const r = await saveField("client_assignments", { client_id: clientId, role_id: roleId }, "person_id", base, next);
    // The row went (someone unassigned it) since this page loaded.
    return r.status === "not_found" ? { status: "conflict", theirs: await stored() } : r;
  }
  if (next !== null) {
    const { error } = await supabase
      .from("client_assignments")
      .insert({ client_id: clientId, role_id: roleId, person_id: next, workspace_id: workspaceId });
    if (error?.code === "23505") {
      const theirs = await stored();
      return theirs === next ? { status: "saved", value: next } : { status: "conflict", theirs };
    }
    if (error) return { status: "error", message: failure(error).error! };
    return { status: "saved", value: next };
  }
  const { data, error } = await supabase
    .from("client_assignments")
    .delete()
    .eq("client_id", clientId)
    .eq("role_id", roleId)
    .eq("person_id", base!)
    .select("person_id");
  if (error) return { status: "error", message: failure(error).error! };
  if (!data.length) {
    const theirs = await stored();
    return theirs === null ? { status: "saved", value: null } : { status: "conflict", theirs };
  }
  return { status: "saved", value: null };
}

/** Add clients with their services and assignments; names must be new. */
async function insertClients(workspaceId: string, clients: NewClient[]): Promise<ActionResult> {
  const supabase = await createSupabase();
  const { data: rows, error } = await supabase
    .from("clients")
    .insert(
      clients.map((c) => ({
        workspace_id: workspaceId,
        name: c.name,
        start_date: c.start_date,
        mrr: c.mrr,
        health: c.health,
        notes: c.notes,
        active: c.active,
        provenance: newClientProvenance(c),
      })),
    )
    .select("id, name");
  if (error) return failure(error);
  const idOf = new Map(rows.map((r) => [r.name, r.id]));
  const services = clients.flatMap((c) => c.serviceIds.map((service_id) => ({ client_id: idOf.get(c.name)!, service_id, workspace_id: workspaceId })));
  const assignments = clients.flatMap((c) =>
    Object.entries(c.assignments).map(([role_id, person_id]) => ({ client_id: idOf.get(c.name)!, role_id, person_id, workspace_id: workspaceId })),
  );
  for (const [table, values] of [
    ["client_services", services],
    ["client_assignments", assignments],
  ] as const) {
    if (!values.length) continue;
    const { error: linkError } = await supabase.from(table).insert(values as never);
    if (linkError) {
      // Don't leave half-imported clients behind.
      await supabase.from("clients").delete().in("id", rows.map((r) => r.id));
      return failure(linkError);
    }
  }
  return { created: rows.length };
}

async function existingNames(workspaceId: string): Promise<Set<string>> {
  const supabase = await createSupabase();
  const { data } = await supabase.from("clients").select("name").eq("workspace_id", workspaceId);
  return new Set((data ?? []).map((r) => r.name.trim().toLowerCase()));
}

/** The add-client form: name, MRR and one service. */
export async function createRosterClient(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "That workspace isn't valid." };
  const mrrText = String(form.get("mrr") ?? "").trim();
  const service = String(form.get("service_id") ?? "");
  const checked = checkNewClient({
    name: String(form.get("name") ?? ""),
    mrr: mrrText === "" ? 0 : Number(mrrText),
    serviceIds: service ? [service] : [],
    assignments: {},
  });
  if ("error" in checked) return checked;
  if (!(await signedIn())) return { error: signedOut.message };
  if ((await existingNames(workspaceId)).has(checked.name.toLowerCase())) return { error: `${checked.name} is already on the roster.` };
  const result = await insertClients(workspaceId, [checked]);
  if (!result.error) refresh();
  return result;
}

/** Import the clients a CSV paste parsed into (see lib/clients/csv.ts). */
export async function importRosterClients(workspaceId: string, clients: unknown[]): Promise<ActionResult> {
  if (!isId(workspaceId) || !Array.isArray(clients) || !clients.length || clients.length > MAX_IMPORT) {
    return { error: "Nothing to import." };
  }
  const checked: NewClient[] = [];
  for (const c of clients) {
    const one = checkNewClient(c);
    if ("error" in one) return one;
    checked.push(one);
  }
  if (!(await signedIn())) return { error: signedOut.message };
  const taken = await existingNames(workspaceId);
  const seen = new Set<string>();
  for (const c of checked) {
    const key = c.name.toLowerCase();
    if (taken.has(key) || seen.has(key)) return { error: `${c.name} is already on the roster. Paste again to refresh the preview.` };
    seen.add(key);
  }
  const result = await insertClients(workspaceId, checked);
  if (!result.error) refresh();
  return result;
}

export async function removeRosterClient(clientId: string): Promise<ActionResult> {
  if (!isId(clientId)) return { error: "That client isn't valid." };
  if (!(await signedIn())) return { error: signedOut.message };
  const supabase = await createSupabase();
  const { data, error } = await supabase.from("clients").delete().eq("id", clientId).select("id");
  if (error) return failure(error);
  if (!data.length) return { error: "That client was already removed, or you don't have permission." };
  refresh();
  return {};
}
