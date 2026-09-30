// The client roster in the app (issue #18): what the Clients page shows and
// edits, input checks, and each person's client load. Pure, so it can be unit
// tested. The checks only reject malformed input early: every write still runs
// as the signed-in user through RLS and the tables' check constraints.

import {
  engineRecurrence,
  type ClientAssignmentRow,
  type ClientRow,
  type ClientServiceRow,
  type PersonRoleRow,
  type PersonRow,
  type ProcessBundle,
  type RoleRow,
  type ServiceRow,
  type ServiceServicingRow,
  type WorkspaceSettings,
} from "@transpera-flow/db";
import { rosterLoads, type EngineModel, type EnginePerson } from "@transpera-flow/engine";

type Scalar = string | number | boolean | null;
type Check = (v: unknown) => boolean;

/** Everything the Clients page needs. */
export interface RosterData {
  workspace: { id: string; name: string; slug: string; settings: WorkspaceSettings };
  /** Owners, editors and agency admins may change the roster. */
  canEdit: boolean;
  roles: Pick<RoleRow, "id" | "name" | "color" | "headcount" | "default_cost_rate" | "ongoing_hours_per_client_week">[];
  people: Pick<PersonRow, "id" | "name" | "fte" | "capacity_hours_week" | "active">[];
  personRoles: PersonRoleRow[];
  services: ServiceRow[];
  clients: ClientRow[];
  clientServices: ClientServiceRow[];
  clientAssignments: ClientAssignmentRow[];
  /** Which servicing processes each service's clients run (issue #19): those services need no fallback load. */
  servicingLinks?: ServiceServicingRow[];
  /**
   * The workspace's pipeline at its live revision, with its servicing
   * processes, to simulate the roster as it stands on this page (issue #19).
   * Null or omitted: no simulated health.
   */
  simulation?: ProcessBundle | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const between = (min: number, max: number): Check => (v) => number(v) && (v as number) >= min && (v as number) <= max;

export const MAX_NAME = 200;
export const MAX_NOTES = 2000;
/** Catches an extra zero or three, well inside what the database stores. */
export const MAX_MRR = 1e8;
/** Most clients one paste may add. */
export const MAX_IMPORT = 500;

/** Client columns saved one at a time, and what each accepts. */
export const CLIENT_FIELDS = {
  name: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_NAME,
  start_date: (v) => v === null || isDate(v),
  mrr: between(0, MAX_MRR),
  health: (v) => v === null || between(0, 100)(v),
  notes: (v) => v === null || (typeof v === "string" && v.length <= MAX_NOTES),
  active: (v) => typeof v === "boolean",
} as const satisfies Record<string, Check>;

export type ClientField = keyof typeof CLIENT_FIELDS;

const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);

/** A single-field save's inputs, if well formed (text trimmed; blank notes become null). Null otherwise. */
export function parseClientField(
  clientId: unknown,
  field: unknown,
  base: unknown,
  value: unknown,
): { clientId: string; field: ClientField; base: Scalar; value: Scalar } | null {
  if (!isId(clientId) || typeof field !== "string" || !Object.hasOwn(CLIENT_FIELDS, field)) return null;
  const f = field as ClientField;
  let cleaned = typeof value === "string" ? value.trim() : value;
  if (f === "notes" && cleaned === "") cleaned = null;
  if (!isScalar(base) || !CLIENT_FIELDS[f](cleaned)) return null;
  return { clientId, field: f, base, value: cleaned as Scalar };
}

/** A client to add, with its services and assignments (the add form and CSV import). */
export interface NewClient {
  name: string;
  start_date: string | null;
  mrr: number;
  health: number | null;
  notes: string | null;
  active: boolean;
  serviceIds: string[];
  /** Role id → person id. */
  assignments: Record<string, string>;
}

/** A well-formed new client, or why not. */
export function checkNewClient(v: unknown): NewClient | { error: string } {
  if (!v || typeof v !== "object") return { error: "That client isn't valid." };
  const c = v as Record<string, unknown>;
  const name = typeof c.name === "string" ? c.name.trim() : "";
  if (!CLIENT_FIELDS.name(name)) return { error: "Enter a name." };
  const notes = typeof c.notes === "string" && c.notes.trim() ? c.notes.trim() : null;
  const checks: [unknown, Check, string][] = [
    [c.start_date ?? null, CLIENT_FIELDS.start_date, "a start date as YYYY-MM-DD"],
    [c.mrr, CLIENT_FIELDS.mrr, "an MRR of 0 or more"],
    [c.health ?? null, CLIENT_FIELDS.health, "a health between 0 and 100"],
    [notes, CLIENT_FIELDS.notes, `notes under ${MAX_NOTES} characters`],
    [c.active ?? true, CLIENT_FIELDS.active, "whether they're active"],
  ];
  for (const [value, check, what] of checks) if (!check(value)) return { error: `${name}: enter ${what}.` };
  const serviceIds = Array.isArray(c.serviceIds) ? c.serviceIds : [];
  if (serviceIds.length > 50 || !serviceIds.every(isId)) return { error: `${name}: those services aren't valid.` };
  const assignments = c.assignments && typeof c.assignments === "object" ? (c.assignments as Record<string, unknown>) : {};
  const pairs = Object.entries(assignments);
  if (pairs.length > 50 || !pairs.every(([r, p]) => isId(r) && isId(p))) return { error: `${name}: those assignments aren't valid.` };
  return {
    name,
    start_date: (c.start_date as string | null | undefined) ?? null,
    mrr: c.mrr as number,
    health: (c.health as number | null | undefined) ?? null,
    notes,
    active: (c.active as boolean | undefined) ?? true,
    serviceIds: [...new Set(serviceIds as string[])],
    assignments: Object.fromEntries(pairs) as Record<string, string>,
  };
}

/**
 * Provenance for a new client's values: what a person typed or pasted is
 * `entered`; a health left blank is simulated from the estimated default, so
 * it is marked `estimated` rather than stamped as entered.
 */
export function newClientProvenance(c: Pick<NewClient, "health">): Record<string, { source: "estimated" }> {
  return c.health === null ? { health: { source: "estimated" } } : {};
}

/** Health the simulation starts a client at when none is entered (docs/PRD.md §6.3.5). */
export const DEFAULT_HEALTH = 80;

/** A person's load from their clients, against their week. */
export interface PersonClientLoad {
  personId: string;
  name: string;
  roleIds: string[];
  /** Working hours a week. */
  capacity: number;
  /** Fallback ongoing hours a week from their clients (and a share of unassigned ones). */
  hours: number;
  /** Clients assigned to them in any role. */
  clients: number;
  /** Fits their week; needs overtime within the cap; over even that. */
  status: "ok" | "overtime" | "over";
}

/**
 * Each active person's ongoing load from the roster as it stands: the
 * fallback load of their clients' services (docs/PRD.md §6.3.4), resolved as
 * the simulation resolves it at the start of a run. People with no roles and
 * no clients are left out.
 */
export function personClientLoads(data: RosterData): PersonClientLoad[] {
  const s = data.workspace.settings;
  const cap = Number(s.overtime_cap ?? 0);
  const roleIds = new Set(data.roles.map((r) => r.id));
  const people: Record<string, EnginePerson> = {};
  for (const p of data.people.filter((p) => p.active)) {
    people[p.id] = {
      name: p.name,
      roles: data.personRoles.filter((r) => r.person_id === p.id && roleIds.has(r.role_id)).map((r) => r.role_id).sort(),
      capacity: p.capacity_hours_week != null ? Number(p.capacity_hours_week) : Number(p.fte) * s.hours_per_week,
    };
  }
  const services: NonNullable<EngineModel["services"]> = {};
  // A service with a servicing process needs no fallback load: its tasks are the client work (docs/PRD.md §6.3.4).
  const servicingProcesses: NonNullable<EngineModel["servicingProcesses"]> = {};
  const linksOf = (serviceId: string) =>
    (data.servicingLinks ?? []).flatMap((l) => {
      const recurrence = l.service_id === serviceId ? engineRecurrence(l.recurrence) : null;
      if (!recurrence) return [];
      servicingProcesses[l.process_id] = { name: "", entry: "", steps: [] };
      return [{ process: l.process_id, recurrence, sla: Number(l.sla_hours) }];
    });
  for (const sv of data.services.filter((sv) => sv.active)) {
    // A cleared value is stored as null: left out, as model resolution does.
    const entries = Object.entries(sv.fallback_ongoing_load ?? {}).filter(
      ([rid, h]) => roleIds.has(rid) && h !== null && Number.isFinite(Number(h)) && Number(h) >= 0,
    );
    services[sv.id] = {
      name: sv.name,
      pricingModel: sv.pricing_model,
      price: Number(sv.price),
      margin: Number(sv.margin),
      tenureMonths: Number(sv.tenure_months),
      churnMonthly: Number(sv.churn_monthly_base),
      mixShare: Number(sv.mix_share),
      pathTags: [],
      ...(entries.length ? { fallbackOngoing: Object.fromEntries(entries.map(([rid, h]) => [rid, Number(h)])) } : {}),
      servicing: linksOf(sv.id),
    };
  }
  const clients: NonNullable<EngineModel["clients"]> = {};
  for (const c of [...data.clients].filter((c) => c.active).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    clients[c.id] = {
      name: c.name,
      services: data.clientServices.filter((cs) => cs.client_id === c.id && cs.service_id in services).map((cs) => cs.service_id).sort(),
      mrr: Number(c.mrr),
      assignments: Object.fromEntries(
        data.clientAssignments.filter((a) => a.client_id === c.id && roleIds.has(a.role_id)).map((a) => [a.role_id, a.person_id]),
      ),
    };
  }
  const model: EngineModel = {
    horizonWeeks: s.horizon_weeks,
    hoursPerWeek: s.hours_per_week,
    leadsPerWeek: 0,
    activeClients: Object.keys(clients).length,
    churnMonthly: 0,
    retainer: 0,
    roles: Object.fromEntries(
      data.roles.map((r) => [r.id, { name: r.name, count: r.headcount, cost: Number(r.default_cost_rate), ongoing: Number(r.ongoing_hours_per_client_week) }]),
    ),
    services,
    people,
    clients,
    servicingProcesses,
    entry: "",
    sinks: { won: "", lost: "" },
    steps: [],
  };
  const loads = rosterLoads(model, people);
  return Object.entries(people)
    .map(([id, p]) => {
      const load = loads[id]!;
      const status: PersonClientLoad["status"] =
        load.hours <= p.capacity + 1e-9 ? "ok" : load.hours <= p.capacity * (1 + cap) + 1e-9 ? "overtime" : "over";
      return { personId: id, name: p.name, roleIds: p.roles, capacity: p.capacity, hours: load.hours, clients: load.clients, status };
    })
    .filter((l) => l.roleIds.length || l.clients);
}

/** Totals for the page header: active clients, their MRR, and how many take each service. */
export function rosterSummary(data: Pick<RosterData, "clients" | "clientServices">): {
  active: number;
  inactive: number;
  mrr: number;
  byService: Map<string, number>;
} {
  const active = data.clients.filter((c) => c.active);
  const ids = new Set(active.map((c) => c.id));
  const byService = new Map<string, number>();
  for (const cs of data.clientServices) if (ids.has(cs.client_id)) byService.set(cs.service_id, (byService.get(cs.service_id) ?? 0) + 1);
  return { active: active.length, inactive: data.clients.length - active.length, mrr: active.reduce((sum, c) => sum + Number(c.mrr), 0), byService };
}
