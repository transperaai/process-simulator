// Company-model suggestions (docs/PRD.md §7.1c, decision D19, issue #25):
// what a suggestion may change, how it reads to a reviewer ("Claude suggests
// lead volume 15/wk for Google Ads, was 4/wk, citing …"), and applying one to
// an in-memory company model. The database applies accepted suggestions itself
// (`public.review_suggestions`, migration 20261015000000_suggestions.sql);
// `applySuggestion` mirrors it for the demo, and a test keeps the two in step.
// Pure: no I/O, and the clock and new ids come from the caller.

import { fieldMeta, formatCompanyValue, MONTH_NAMES, type CompanyModel } from "./company";
import type {
  EvidenceCitation,
  Provenance,
  ProvenanceMap,
  SuggestionApplied,
  SuggestionPatch,
  SuggestionRow,
  SuggestionTarget,
} from "./types";

/** The columns (settings keys, for `workspaces`) a suggestion may set, per table. Mirrors `private.apply_suggestion`. */
export const SUGGESTION_COLUMNS: Record<SuggestionTarget, readonly string[]> = {
  workspaces: [
    "hours_per_week",
    "working_days",
    "currency",
    "fy_start",
    "overhead_monthly",
    "target_margin",
    "overtime_cap",
    "availability_floor",
    "utilisation_threshold",
    "capacity_factor_enabled",
    "horizon_weeks",
    "leads_per_week",
    "active_clients",
    "churn_monthly",
    "retainer",
  ],
  services: ["name", "pricing_model", "price", "margin", "tenure_months", "churn_monthly_base", "churn_health_sensitivity", "mix_share", "active"],
  people: ["name", "email", "fte", "capacity_hours_week", "cost_rate", "active", "start_date", "end_date", "notes"],
  clients: ["name", "start_date", "mrr", "health", "notes", "active"],
  lead_sources: ["name", "volume_week", "conversion_to_qualified"],
  seasonality: ["month", "multiplier"],
  demand_settings: ["growth_monthly"],
};

/** Columns that name or describe a row rather than hold a value: no provenance. */
export const PLAIN_COLUMNS: readonly string[] = ["name", "notes", "email", "active", "month"];

export class SuggestionError extends Error {}

/** Why a patch can't be suggested for a table, or null if it can. */
export function patchProblem(target: SuggestionTarget, patch: SuggestionPatch): string | null {
  const allowed = SUGGESTION_COLUMNS[target];
  if (!allowed) return `${target} can't be suggested`;
  for (const k of Object.keys(patch.set ?? {})) if (!allowed.includes(k)) return `${k} can't be suggested for ${target}`;
  if ((patch.roles || patch.leave) && target !== "people") return `That patch doesn't apply to ${target}`;
  if ((patch.services || patch.assignments) && target !== "clients") return `That patch doesn't apply to ${target}`;
  return null;
}

/** The provenance an accepted suggestion gives each value it sets: an estimate carrying its evidence. */
export function suggestionProvenance(s: Pick<SuggestionRow, "id" | "note" | "evidence">, at: string, by: string | null): Provenance {
  const p: Provenance = { source: "estimated", at };
  if (by) p.by = by;
  if (s.note) p.note = s.note;
  if (s.evidence.length) p.evidence = s.evidence;
  else p.assumption = true;
  p.suggestion_id = s.id;
  return p;
}

// ---------------------------------------------------------------------------
// Reading a suggestion
// ---------------------------------------------------------------------------

/** One field a suggestion changes, as the reviewer sees it. */
export interface SuggestionChange {
  field: string;
  label: string;
  /** Formatted value now (or, once accepted, before accepting); null for a new row. */
  before: string | null;
  after: string;
  /** The value doesn't differ from what's there now. */
  unchanged: boolean;
  /** The current value was entered by a person or measured: accepting overrides a recorded fact. */
  overridesFact: boolean;
}

export interface SuggestionView {
  /** "Lead source Google Ads", "New person Jo Smith", "Company settings". */
  subject: string;
  action: "create" | "update";
  /** The row it changes no longer exists. */
  missing: boolean;
  changes: SuggestionChange[];
  /** "Claude suggests lead volume 15/wk for Google Ads, was 4/wk, citing “…” (Priya Shah)". */
  headline: string;
}

const NOUN: Record<SuggestionTarget, string> = {
  workspaces: "company settings",
  services: "service",
  people: "person",
  clients: "client",
  lead_sources: "lead source",
  seasonality: "seasonality",
  demand_settings: "demand",
};

type Row = Record<string, unknown> & { provenance?: ProvenanceMap };

/** The row a suggestion targets in the model, if it exists (for seasonality, the month's row). */
export function suggestionTarget(s: Pick<SuggestionRow, "target_table" | "target_id" | "patch">, model: CompanyModel): Row | null {
  switch (s.target_table) {
    case "workspaces":
      return { ...(model.workspace.settings as unknown as Row), provenance: model.workspace.provenance };
    case "demand_settings":
      return (model.demand as unknown as Row) ?? null;
    case "seasonality": {
      const month = Number(s.patch.set.month);
      const row = s.target_id ? model.seasonality.find((m) => m.id === s.target_id) : model.seasonality.find((m) => m.month === month);
      return (row as unknown as Row) ?? null;
    }
    case "services":
      return (model.services.find((r) => r.id === s.target_id) as unknown as Row) ?? null;
    case "people":
      return (model.people.find((r) => r.id === s.target_id) as unknown as Row) ?? null;
    case "clients":
      return (model.clients.find((r) => r.id === s.target_id) as unknown as Row) ?? null;
    case "lead_sources":
      return (model.leadSources.find((r) => r.id === s.target_id) as unknown as Row) ?? null;
  }
}

const same = (a: unknown, b: unknown) => {
  const n = (v: unknown) => (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : (v ?? null));
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
};

const quoteOf = (evidence: readonly EvidenceCitation[]) => {
  const quoted = evidence.filter((e) => e.quote?.trim());
  if (!quoted.length) return "";
  const first = quoted[0]!;
  return ` citing “${first.quote.trim()}”${first.speaker ? ` (${first.speaker})` : ""}${quoted.length > 1 ? ` and ${quoted.length - 1} more` : ""}`;
};

/**
 * How a suggestion reads to its reviewer. Before values are the model's now
 * while pending, and what was there when it was accepted once it has been.
 */
export function describeSuggestion(s: SuggestionRow, model: CompanyModel, suggester = "Claude"): SuggestionView {
  const currency = model.workspace.settings.currency || "GBP";
  const table = s.target_table;
  const row = suggestionTarget(s, model);
  const singleton = table === "workspaces" || table === "demand_settings";
  const creating = !singleton && !s.target_id && !(table === "seasonality" && row);
  const missing = !creating && !singleton && !row && s.status === "pending";
  const recorded = s.status === "accepted" && s.applied ? s.applied.before : null;
  const beforeOf = (field: string): unknown => {
    if (s.status === "accepted") return recorded ? recorded[field] : undefined;
    return row ? row[field] : undefined;
  };
  const provOf = (field: string) => row?.provenance?.[table === "workspaces" ? `settings.${field}` : field];

  const roleName = (id: string) => model.roles.find((r) => r.id === id)?.name ?? "a role no longer in the model";
  const serviceName = (id: string) => model.services.find((r) => r.id === id)?.name ?? "a service no longer in the model";
  const personName = (id: string | null) => (id ? (model.people.find((r) => r.id === id)?.name ?? "someone no longer in the model") : "nobody");

  const changes: SuggestionChange[] = [];
  const hasBefore = !creating && (s.status !== "accepted" || recorded !== null);
  for (const [field, value] of Object.entries(s.patch.set ?? {})) {
    if (table === "seasonality" && field === "month") continue;
    const meta = fieldMeta(table, field);
    const was = beforeOf(field);
    const prov = provOf(field);
    changes.push({
      field,
      label: table === "seasonality" ? `${MONTH_NAMES[Number(s.patch.set.month) - 1] ?? "Month"} multiplier` : meta.label,
      before: hasBefore ? formatCompanyValue(meta.format, was ?? null, currency) : null,
      after: formatCompanyValue(meta.format, value, currency),
      unchanged: hasBefore && s.status === "pending" && same(was, value),
      overridesFact:
        s.status === "pending" && !creating && !!prov && (prov.source === "entered" || prov.source === "measured") && !same(was, value),
    });
  }
  const setChange = (field: "roles" | "services", ids: string[], name: (id: string) => string) => {
    const now =
      field === "roles"
        ? model.personRoles.filter((x) => x.person_id === s.target_id).map((x) => x.role_id)
        : model.clientServices.filter((x) => x.client_id === s.target_id).map((x) => x.service_id);
    const was = s.status === "accepted" ? (recorded?.[field] as string[] | undefined) : now;
    const list = (xs: readonly string[]) => xs.map(name).sort().join(", ") || "none";
    changes.push({
      field,
      label: field === "roles" ? "Roles" : "Services",
      before: hasBefore && was ? list(was) : null,
      after: list(ids),
      unchanged: hasBefore && s.status === "pending" && list(now) === list(ids),
      overridesFact: false,
    });
  };
  if (s.patch.roles) setChange("roles", s.patch.roles, roleName);
  if (s.patch.services) setChange("services", s.patch.services, serviceName);
  for (const [roleId, personId] of Object.entries(s.patch.assignments ?? {})) {
    const now = model.clientAssignments.find((a) => a.client_id === s.target_id && a.role_id === roleId)?.person_id ?? null;
    const was =
      s.status === "accepted" ? (((recorded?.assignments as Record<string, string> | undefined) ?? {})[roleId] ?? null) : now;
    changes.push({
      field: `assignments.${roleId}`,
      label: roleName(roleId),
      before: hasBefore ? personName(was) : null,
      after: personName(personId),
      unchanged: hasBefore && s.status === "pending" && now === personId,
      overridesFact: false,
    });
  }
  for (const l of s.patch.leave ?? []) {
    changes.push({
      field: "leave",
      label: "Leave",
      before: null,
      after: `${l.start_date} to ${l.end_date}${l.note ? ` (${l.note})` : ""}`,
      unchanged: false,
      overridesFact: false,
    });
  }

  const name = String(s.patch.set.name ?? row?.name ?? "");
  const subject =
    table === "workspaces"
      ? "Company settings"
      : table === "demand_settings"
        ? "Demand growth"
        : table === "seasonality"
          ? `Seasonality: ${MONTH_NAMES[Number(s.patch.set.month ?? row?.month) - 1] ?? "a month"}`
          : `${creating ? "New " : ""}${creating ? NOUN[table] : NOUN[table][0]!.toUpperCase() + NOUN[table].slice(1)} ${name}`.trim();

  let headline: string;
  const cite = quoteOf(s.evidence);
  if (creating) {
    const details = changes
      .filter((c) => c.field !== "name")
      .map((c) => `${c.label.toLowerCase()} ${c.after}`)
      .join(", ");
    headline = `${suggester} suggests adding ${NOUN[table]} ${name}${details ? ` (${details})` : ""}${cite ? `,${cite}` : ""}`;
  } else {
    const shown = changes.filter((c) => !c.unchanged);
    const first = shown[0] ?? changes[0];
    const where =
      table === "workspaces" || table === "demand_settings" || table === "seasonality" ? "" : ` for ${name || NOUN[table]}`;
    if (!first) headline = `${suggester} suggests no change to ${subject.toLowerCase()}`;
    else {
      const label = first.label === "Name" ? "renaming to" : first.label.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
      const more = shown.length > 1 ? ` (and ${shown.length - 1} more change${shown.length > 2 ? "s" : ""})` : "";
      headline = `${suggester} suggests ${label} ${first.after}${where}${first.before !== null ? `, was ${first.before}` : ""}${more}${cite ? `,${cite}` : ""}`;
    }
  }
  return { subject, action: creating ? "create" : "update", missing, changes, headline };
}

// ---------------------------------------------------------------------------
// Applying a suggestion to an in-memory model (the demo)
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  /** ISO timestamp for the provenance. */
  at: string;
  /** Who accepted it. */
  by: string | null;
  /** An id for a new row. */
  newId: () => string;
}

const DEFAULTS = {
  services: {
    pricing_model: "retainer",
    price: 0,
    margin: 0,
    tenure_months: 12,
    churn_monthly_base: 0,
    mix_share: 1,
    entry_process_id: null,
    path_tags: [],
    fallback_ongoing_load: {},
    active: true,
  },
  people: { fte: 1, capacity_hours_week: null, cost_rate: null, active: true, start_date: null, end_date: null },
  clients: { start_date: null, mrr: 0, health: null, notes: null, active: true },
  lead_sources: { volume_week: 0, conversion_to_qualified: 1 },
  seasonality: { multiplier: 1 },
} as const;

/**
 * The model with a suggestion applied, as `private.apply_suggestion` applies
 * it in the database, and what changed. Throws SuggestionError when it can't
 * be applied (a field that can't be suggested, a row that's gone).
 */
export function applySuggestion(model: CompanyModel, s: SuggestionRow, opts: ApplyOptions): { model: CompanyModel; applied: SuggestionApplied } {
  const problem = patchProblem(s.target_table, s.patch);
  if (problem) throw new SuggestionError(problem);
  const table = s.target_table;
  const set = s.patch.set ?? {};
  const entry = suggestionProvenance(s, opts.at, opts.by);
  const prov: ProvenanceMap = {};
  for (const k of Object.keys(set)) if (!PLAIN_COLUMNS.includes(k)) prov[table === "workspaces" ? `settings.${k}` : k] = entry;
  const pickBefore = (row: Record<string, unknown>) => Object.fromEntries(Object.keys(set).map((k) => [k, row[k] ?? null]));
  const ws = model.workspace.id;

  if (table === "workspaces") {
    const before = pickBefore(model.workspace.settings as unknown as Record<string, unknown>);
    return {
      model: {
        ...model,
        workspace: {
          ...model.workspace,
          settings: { ...model.workspace.settings, ...(set as object) },
          provenance: { ...(model.workspace.provenance ?? {}), ...prov },
        },
      },
      applied: { target_id: ws, before, after: { ...set } },
    };
  }
  if (table === "demand_settings") {
    const was = model.demand;
    const demand = was
      ? { ...was, ...(set as object), provenance: { ...was.provenance, ...prov } }
      : { workspace_id: ws, growth_monthly: 0, ...(set as object), provenance: prov };
    return {
      model: { ...model, demand: demand as CompanyModel["demand"] },
      applied: { target_id: ws, before: was ? pickBefore(was as unknown as Record<string, unknown>) : null, after: { ...set } },
    };
  }

  type Keyed = "services" | "people" | "clients" | "leadSources" | "seasonality";
  const key: Keyed = table === "lead_sources" ? "leadSources" : (table as Keyed);
  const rows = model[key] as unknown as (Record<string, unknown> & { id: string; provenance?: ProvenanceMap })[];
  let target = s.target_id;
  if (table === "seasonality" && !target) target = (rows.find((m) => m.month === Number(set.month))?.id as string | undefined) ?? null;

  let next: CompanyModel = model;
  let before: Record<string, unknown> | null = null;
  if (!target) {
    if (!Object.keys(set).length) throw new SuggestionError("Nothing to create");
    target = opts.newId();
    const row = { id: target, workspace_id: ws, ...DEFAULTS[table as keyof typeof DEFAULTS], ...set, provenance: prov };
    next = { ...model, [key]: [...rows, row] } as CompanyModel;
  } else {
    const current = rows.find((r) => r.id === target);
    if (!current) throw new SuggestionError("What this suggestion changes no longer exists");
    before = pickBefore(current);
    const updated = { ...current, ...set, provenance: { ...(current.provenance ?? {}), ...prov } };
    next = { ...model, [key]: rows.map((r) => (r.id === target ? updated : r)) } as CompanyModel;
  }

  const id = target;
  if (table === "people" && s.patch.roles) {
    if (before) before.roles = next.personRoles.filter((x) => x.person_id === id).map((x) => x.role_id).sort();
    const roles = [...new Set(s.patch.roles)];
    next = {
      ...next,
      personRoles: [
        ...next.personRoles.filter((x) => x.person_id !== id),
        ...roles.map((role_id) => ({ person_id: id, role_id, workspace_id: ws })),
      ],
    };
  }
  if (table === "people" && s.patch.leave) {
    const leave = [...next.personLeave];
    for (const l of s.patch.leave) {
      if (!leave.some((x) => x.person_id === id && x.start_date === l.start_date && x.end_date === l.end_date)) {
        leave.push({ id: opts.newId(), person_id: id, workspace_id: ws, start_date: l.start_date, end_date: l.end_date });
      }
    }
    next = { ...next, personLeave: leave };
  }
  if (table === "clients" && s.patch.services) {
    if (before) before.services = next.clientServices.filter((x) => x.client_id === id).map((x) => x.service_id).sort();
    const services = [...new Set(s.patch.services)];
    const kept = next.clientServices.filter((x) => x.client_id === id && services.includes(x.service_id));
    next = {
      ...next,
      clientServices: [
        ...next.clientServices.filter((x) => x.client_id !== id),
        ...kept,
        ...services
          .filter((sv) => !kept.some((k) => k.service_id === sv))
          .map((service_id) => ({ client_id: id, service_id, workspace_id: ws, start_date: null })),
      ],
    };
  }
  if (table === "clients" && s.patch.assignments) {
    if (before) {
      before.assignments = Object.fromEntries(next.clientAssignments.filter((x) => x.client_id === id).map((x) => [x.role_id, x.person_id]));
    }
    let assignments = [...next.clientAssignments];
    for (const [role_id, person_id] of Object.entries(s.patch.assignments)) {
      assignments = assignments.filter((a) => !(a.client_id === id && a.role_id === role_id));
      if (person_id) assignments.push({ client_id: id, role_id, person_id, workspace_id: ws });
    }
    next = { ...next, clientAssignments: assignments };
  }

  const links: Partial<SuggestionPatch> = { ...s.patch };
  delete links.set;
  return { model: next, applied: { target_id: id, before, after: { ...set, ...links } } };
}
