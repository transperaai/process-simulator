"use server";

import { refresh } from "next/cache";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { saveField, saveLinks } from "@/lib/fields/server";
import { isTagList, parseNewService, parseServiceField, type ServiceField } from "@/lib/services";
import { createClient } from "@/lib/supabase/server";

// Writes from the workspace settings page. Every write runs as the signed-in
// user through RLS; these checks only reject malformed input early.

type Scalar = string | number | boolean | null;
type Check = (v: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const text: Check = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const optionalText: Check = (v) => v === null || (typeof v === "string" && v.length <= 2000);
const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const optionalNumber: Check = (v) => v === null || number(v);
const optionalDate: Check = (v) => v === null || isDate(v);
const boolean: Check = (v) => typeof v === "boolean";

const PERSON_FIELDS = {
  name: text,
  email: optionalText,
  notes: optionalText,
  fte: number,
  capacity_hours_week: optionalNumber,
  cost_rate: optionalNumber,
  active: boolean,
  start_date: optionalDate,
  end_date: optionalDate,
} as const satisfies Record<string, Check>;

export type PersonField = keyof typeof PERSON_FIELDS;

const invalid = { status: "error", message: "That value isn't valid." } as const;
const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);

async function signedIn(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims?.sub);
}

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;

export async function savePersonField(
  personId: string,
  field: PersonField,
  base: Scalar,
  value: Scalar,
): Promise<SaveOutcome<Scalar>> {
  const check: Check | undefined = Object.hasOwn(PERSON_FIELDS, field) ? PERSON_FIELDS[field] : undefined;
  if (!isId(personId) || !check || !check(value) || !isScalar(base)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("people", { id: personId }, field, base, typeof value === "string" ? value.trim() : value);
}

export async function savePersonSet(
  personId: string,
  workspaceId: string,
  set: "roles" | "skills",
  base: string[],
  next: string[],
): Promise<SaveOutcome<string[]>> {
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 500 && v.every(isId);
  if (!isId(personId) || !isId(workspaceId) || !ids(base) || !ids(next)) return invalid;
  if (set !== "roles" && set !== "skills") return invalid;
  if (!(await signedIn())) return signedOut;
  return saveLinks(set === "roles" ? "person_roles" : "person_skills", { person_id: personId, workspace_id: workspaceId }, base, next);
}

/** Minimum share of each week left for pipeline work; null restores the default. */
export async function saveAvailabilityFloor(
  workspaceId: string,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  const fraction = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) < 1);
  if (!isId(workspaceId) || !fraction(value) || !isScalar(base)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("workspaces", { id: workspaceId }, "settings.availability_floor", base, value);
}

export interface ActionResult {
  error?: string;
}

const failure = (error: { code?: string } | null): ActionResult =>
  error?.code === "42501"
    ? { error: "You don't have permission to do that." }
    : error?.code === "23514"
      ? { error: "Some of those values aren't allowed." }
      : { error: "Couldn't save. Try again." };

export async function createPerson(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const name = String(form.get("name") ?? "").trim();
  const roleId = String(form.get("role_id") ?? "");
  if (!isId(workspaceId) || !text(name)) return { error: "Enter a name." };
  if (roleId && !isId(roleId)) return { error: "Pick a role." };
  const supabase = await createClient();
  const { data: person, error } = await supabase
    .from("people")
    .insert({ workspace_id: workspaceId, name })
    .select("id")
    .single();
  if (error) return failure(error);
  if (roleId) {
    const { error: roleError } = await supabase
      .from("person_roles")
      .insert({ person_id: person.id, role_id: roleId, workspace_id: workspaceId });
    if (roleError) return failure(roleError);
  }
  refresh();
  return {};
}

export async function addLeave(
  personId: string,
  workspaceId: string,
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const start = String(form.get("start_date") ?? "");
  const end = String(form.get("end_date") ?? "") || start;
  const note = String(form.get("note") ?? "").trim() || null;
  if (!isId(personId) || !isId(workspaceId)) return { error: "Couldn't save. Try again." };
  if (!isDate(start) || !isDate(end)) return { error: "Enter the first and last day." };
  if (end < start) return { error: "The last day must be on or after the first." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_leave")
    .insert({ person_id: personId, workspace_id: workspaceId, start_date: start, end_date: end, note });
  if (error) return failure(error);
  refresh();
  return {};
}

export async function removeLeave(leaveId: string): Promise<ActionResult> {
  if (!isId(leaveId)) return { error: "Couldn't remove it. Try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("person_leave").delete().eq("id", leaveId).select("id");
  if (error) return failure(error);
  if (!data.length) return { error: "That leave was already removed, or you can't edit it." };
  refresh();
  return {};
}

// Services (issue #12). Owners and editors manage them; RLS enforces that.

export async function saveServiceField(
  serviceId: string,
  field: ServiceField,
  base: Scalar,
  value: Scalar,
): Promise<SaveOutcome<Scalar>> {
  const parsed = parseServiceField(serviceId, field, base, value);
  if (!parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("services", { id: parsed.serviceId }, parsed.field, parsed.base, parsed.value);
}

/** A service's path tags, saved as one list. */
export async function saveServiceTags(serviceId: string, base: string[], next: string[]): Promise<SaveOutcome<string[]>> {
  if (!isId(serviceId) || !isTagList(base) || !isTagList(next)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField<string[]>("services", { id: serviceId }, "path_tags", base, next);
}

export async function createService(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "Couldn't save. Try again." };
  const service = parseNewService(form);
  if ("error" in service) return service;
  const supabase = await createClient();
  // The first service takes every arrival; later ones start at a share of 0,
  // so adding one doesn't change the simulation until its share is set.
  const { count, error: countError } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (countError) return failure(countError);
  const { error } = await supabase.from("services").insert({ workspace_id: workspaceId, ...service, mix_share: count ? 0 : 1 });
  if (error) return failure(error);
  refresh();
  return {};
}

export async function removeService(serviceId: string): Promise<ActionResult> {
  if (!isId(serviceId)) return { error: "Couldn't remove it. Try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").delete().eq("id", serviceId).select("id");
  if (error) return failure(error);
  if (!data.length) return { error: "That service was already removed, or you can't edit it." };
  refresh();
  return {};
}
