// What the MCP company tools suggest (docs/PRD.md §7.1, §7.1c, decision D19;
// issue #25), free of I/O: given the company model and a tool's arguments,
// resolve names to ids and build the suggestions to store. Nothing here
// changes the model; a person accepts or rejects each suggestion in the app.
//
// - Only values that differ from the model are suggested; the rest are
//   reported as unchanged, and a call that changes nothing stores nothing.
// - `upsert_*` updates the row whose id or name matches exactly (any case). A
//   name that only partly matches existing rows is ambiguous: the call fails
//   with the candidates instead of guessing whether to update or add.
// - Values a new row doesn't get from the call take the database's defaults
//   and are listed as assumptions.

import {
  MONTH_NAMES,
  patchProblem,
  type CompanyModel,
  type EvidenceCitation,
  type SuggestionPatch,
  type SuggestionTarget,
  type SuggestionValue,
} from "@transpera-flow/db";
import { matchNamed } from "./analysis";
import { ToolError } from "./result";

/** One suggestion to store. */
export interface Proposal {
  target_table: SuggestionTarget;
  target_id: string | null;
  patch: SuggestionPatch;
  evidence: EvidenceCitation[];
  note: string | null;
}

export interface Built {
  proposals: Proposal[];
  /** What the call gave that the model already has. */
  unchanged: string[];
}

export interface Provenanced {
  evidence?: EvidenceCitation[];
  note?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const same = (a: unknown, b: unknown) => {
  const n = (v: unknown) => (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : (v ?? null));
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
};

/**
 * The row to update for an upsert: an exact id or name match (any case), or
 * null to add a new one. Partial matches without an exact one are ambiguous
 * unless `create` says a new row is meant.
 */
export function matchForUpsert<T extends { id: string; name: string }>(items: readonly T[], ref: string, kind: string, create = false): T | null {
  const needle = ref.trim().toLowerCase();
  const exact = items.filter((x) => x.id.toLowerCase() === needle || x.name.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new ToolError("ambiguous", `More than one ${kind} is called '${ref}'; pass its id`, exact.map((x) => ({ id: x.id, name: x.name })));
  if (create || UUID.test(needle)) {
    if (UUID.test(needle)) throw new ToolError("not_found", `No ${kind} has the id '${ref}'`);
    return null;
  }
  const partial = items.filter((x) => x.name.toLowerCase().includes(needle) || needle.includes(x.name.trim().toLowerCase()));
  if (partial.length) {
    throw new ToolError(
      "ambiguous",
      `No ${kind} is called '${ref}' exactly, but some are close. Pass the exact name (or id) to update one, or create: true to add a new ${kind}.`,
      partial.map((x) => ({ id: x.id, name: x.name })),
    );
  }
  return null;
}

/** `set` with only the values that differ from `row` (all of them for a new row); the rest go to `unchanged`. */
function diffSet(
  row: Record<string, unknown> | null,
  values: Record<string, SuggestionValue | undefined>,
  label: string,
  unchanged: string[],
): Record<string, SuggestionValue> {
  const set: Record<string, SuggestionValue> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if (row && same(row[k], v)) unchanged.push(`${label}: ${k} is already ${String(v)}`);
    else set[k] = v;
  }
  return set;
}

const hasChanges = (p: SuggestionPatch) =>
  Object.keys(p.set).length > 0 || !!p.roles || !!p.services || !!p.leave?.length || (!!p.assignments && Object.keys(p.assignments).length > 0);

function proposal(target: SuggestionTarget, id: string | null, patch: SuggestionPatch, prov: Provenanced): Proposal {
  const problem = patchProblem(target, patch);
  if (problem) throw new ToolError("invalid_input", problem);
  return { target_table: target, target_id: id, patch, evidence: prov.evidence ?? [], note: prov.note?.trim() || null };
}

const sortedEq = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

// ---------------------------------------------------------------------------
// set_company
// ---------------------------------------------------------------------------

/** Company settings: one suggestion for the settings that differ. */
export function buildCompanySuggestion(model: CompanyModel, settings: Record<string, SuggestionValue | undefined>, prov: Provenanced): Built {
  const unchanged: string[] = [];
  const set = diffSet(model.workspace.settings as unknown as Record<string, unknown>, settings, "Company settings", unchanged);
  if (!Object.keys(set).length) return { proposals: [], unchanged };
  return { proposals: [proposal("workspaces", null, { set }, prov)], unchanged };
}

// ---------------------------------------------------------------------------
// upsert_service
// ---------------------------------------------------------------------------

export interface ServiceArgs extends Provenanced {
  name: string;
  rename?: string;
  create?: boolean;
  pricing_model?: "retainer" | "one_off" | "hourly";
  price?: number;
  margin?: number;
  tenure_months?: number;
  churn_monthly_base?: number;
  mix_share?: number;
  active?: boolean;
}

export function buildServiceSuggestion(model: CompanyModel, args: ServiceArgs, assumptions: string[]): Built {
  const row = matchForUpsert(model.services, args.name, "service", args.create);
  const unchanged: string[] = [];
  const values = {
    name: row ? args.rename?.trim() : args.name.trim(),
    pricing_model: args.pricing_model,
    price: args.price,
    margin: args.margin,
    tenure_months: args.tenure_months,
    churn_monthly_base: args.churn_monthly_base,
    mix_share: args.mix_share,
    active: args.active,
  };
  const set = diffSet(row as unknown as Record<string, unknown>, values, `Service ${row?.name ?? args.name}`, unchanged);
  if (!row) {
    const defaults: [keyof ServiceArgs, string][] = [
      ["pricing_model", "retainer"],
      ["price", "0"],
      ["margin", "0"],
      ["tenure_months", "12"],
      ["churn_monthly_base", "0"],
      ["mix_share", "1"],
    ];
    for (const [k, v] of defaults) if (args[k] === undefined) assumptions.push(`New service '${args.name}': ${k} not given, so it will default to ${v}.`);
  }
  const patch: SuggestionPatch = { set };
  return { proposals: hasChanges(patch) ? [proposal("services", row?.id ?? null, patch, args)] : [], unchanged };
}

// ---------------------------------------------------------------------------
// upsert_person
// ---------------------------------------------------------------------------

export interface PersonArgs extends Provenanced {
  name: string;
  rename?: string;
  create?: boolean;
  roles?: string[];
  fte?: number;
  capacity_hours_week?: number | null;
  cost_rate?: number | null;
  email?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  active?: boolean;
  leave?: { start_date: string; end_date: string; note?: string }[];
}

export function buildPersonSuggestion(model: CompanyModel, args: PersonArgs, assumptions: string[]): Built {
  const row = matchForUpsert(model.people, args.name, "person", args.create);
  const unchanged: string[] = [];
  const label = `Person ${row?.name ?? args.name}`;
  const set = diffSet(
    row as unknown as Record<string, unknown>,
    {
      name: row ? args.rename?.trim() : args.name.trim(),
      fte: args.fte,
      capacity_hours_week: args.capacity_hours_week,
      cost_rate: args.cost_rate,
      email: args.email,
      start_date: args.start_date,
      end_date: args.end_date,
      active: args.active,
    },
    label,
    unchanged,
  );
  const patch: SuggestionPatch = { set };
  if (args.roles) {
    const ids = [...new Set(args.roles.map((r) => matchNamed(model.roles, r, "role").id))];
    const now = row ? model.personRoles.filter((x) => x.person_id === row.id).map((x) => x.role_id) : null;
    if (now && sortedEq(now, ids)) unchanged.push(`${label}: roles are already ${args.roles.join(", ")}`);
    else patch.roles = ids;
  } else if (!row) {
    assumptions.push(`New person '${args.name}': no roles given, so they won't be assigned any work until someone adds a role.`);
  }
  if (args.leave?.length) {
    const fresh = args.leave.filter(
      (l) => !row || !model.personLeave.some((x) => x.person_id === row.id && x.start_date === l.start_date && x.end_date === l.end_date),
    );
    if (fresh.length < args.leave.length) unchanged.push(`${label}: some of that leave is already recorded`);
    if (fresh.length) patch.leave = fresh.map((l) => ({ start_date: l.start_date, end_date: l.end_date, note: l.note ?? null }));
  }
  if (!row && args.fte === undefined) assumptions.push(`New person '${args.name}': fte not given, so it will default to 1.`);
  return { proposals: hasChanges(patch) ? [proposal("people", row?.id ?? null, patch, args)] : [], unchanged };
}

// ---------------------------------------------------------------------------
// upsert_client
// ---------------------------------------------------------------------------

export interface ClientArgs extends Provenanced {
  name: string;
  rename?: string;
  create?: boolean;
  services?: string[];
  mrr?: number;
  start_date?: string | null;
  health?: number | null;
  notes?: string | null;
  active?: boolean;
  /** Role → person (names or ids); null clears the role's assignment. */
  assignments?: Record<string, string | null>;
}

export function buildClientSuggestion(model: CompanyModel, args: ClientArgs, assumptions: string[]): Built {
  const row = matchForUpsert(model.clients, args.name, "client", args.create);
  const unchanged: string[] = [];
  const label = `Client ${row?.name ?? args.name}`;
  const set = diffSet(
    row as unknown as Record<string, unknown>,
    {
      name: row ? args.rename?.trim() : args.name.trim(),
      mrr: args.mrr,
      start_date: args.start_date,
      health: args.health,
      notes: args.notes,
      active: args.active,
    },
    label,
    unchanged,
  );
  const patch: SuggestionPatch = { set };
  if (args.services) {
    const ids = [...new Set(args.services.map((s) => matchNamed(model.services, s, "service").id))];
    const now = row ? model.clientServices.filter((x) => x.client_id === row.id).map((x) => x.service_id) : null;
    if (now && sortedEq(now, ids)) unchanged.push(`${label}: services are already ${args.services.join(", ")}`);
    else patch.services = ids;
  } else if (!row) {
    assumptions.push(`New client '${args.name}': no services given; add them so the client's ongoing work is simulated.`);
  }
  if (args.assignments) {
    const assignments: Record<string, string | null> = {};
    for (const [roleRef, personRef] of Object.entries(args.assignments)) {
      const role = matchNamed(model.roles, roleRef, "role");
      const person = personRef === null ? null : matchNamed(model.people, personRef, "person");
      if (person && !model.personRoles.some((x) => x.person_id === person.id && x.role_id === role.id)) {
        assumptions.push(`${person.name} doesn't have the ${role.name} role; they're suggested for it anyway.`);
      }
      const now = row ? (model.clientAssignments.find((a) => a.client_id === row.id && a.role_id === role.id)?.person_id ?? null) : null;
      if (row && now === (person?.id ?? null)) unchanged.push(`${label}: ${role.name} is already ${person?.name ?? "unassigned"}`);
      else assignments[role.id] = person?.id ?? null;
    }
    if (Object.keys(assignments).length) patch.assignments = assignments;
  }
  if (!row && args.mrr === undefined) assumptions.push(`New client '${args.name}': mrr not given, so it will default to 0.`);
  if (!row && args.health === undefined) assumptions.push(`New client '${args.name}': health not given; simulations start them at the estimated 80.`);
  return { proposals: hasChanges(patch) ? [proposal("clients", row?.id ?? null, patch, args)] : [], unchanged };
}

// ---------------------------------------------------------------------------
// set_demand
// ---------------------------------------------------------------------------

export interface LeadSourceArgs extends Provenanced {
  name: string;
  rename?: string;
  create?: boolean;
  volume_week?: number;
  conversion_to_qualified?: number;
}

export interface DemandArgs extends Provenanced {
  lead_sources?: LeadSourceArgs[];
  /** Twelve multipliers (January first), or the months to change. */
  seasonality?: number[] | { month: number; multiplier: number }[];
  growth_monthly?: number;
}

/** Demand: one suggestion per lead source, per seasonality month and for growth. */
export function buildDemandSuggestions(model: CompanyModel, args: DemandArgs, assumptions: string[]): Built {
  const proposals: Proposal[] = [];
  const unchanged: string[] = [];
  const top: Provenanced = { evidence: args.evidence, note: args.note };
  const prov = (item: Provenanced): Provenanced => ({ evidence: item.evidence ?? top.evidence, note: item.note ?? top.note });

  for (const ls of args.lead_sources ?? []) {
    const row = matchForUpsert(model.leadSources, ls.name, "lead source", ls.create);
    const set = diffSet(
      row as unknown as Record<string, unknown>,
      { name: row ? ls.rename?.trim() : ls.name.trim(), volume_week: ls.volume_week, conversion_to_qualified: ls.conversion_to_qualified },
      `Lead source ${row?.name ?? ls.name}`,
      unchanged,
    );
    if (!row && ls.conversion_to_qualified === undefined) {
      assumptions.push(`New lead source '${ls.name}': conversion_to_qualified not given, so every lead counts as qualified (1).`);
    }
    if (!row && ls.volume_week === undefined) assumptions.push(`New lead source '${ls.name}': volume_week not given, so it will default to 0.`);
    if (Object.keys(set).length) proposals.push(proposal("lead_sources", row?.id ?? null, { set }, prov(ls)));
  }

  if (args.seasonality) {
    const months: { month: number; multiplier: number }[] = args.seasonality.every((v) => typeof v === "number")
      ? (args.seasonality as number[]).map((multiplier, i) => ({ month: i + 1, multiplier }))
      : (args.seasonality as { month: number; multiplier: number }[]);
    for (const { month, multiplier } of months) {
      const row = model.seasonality.find((m) => m.month === month);
      const now = row ? Number(row.multiplier) : 1;
      if (same(now, multiplier)) {
        unchanged.push(`Seasonality in ${MONTH_NAMES[month - 1]}: already ×${multiplier}`);
        continue;
      }
      proposals.push(proposal("seasonality", null, { set: { month, multiplier } }, top));
    }
  }

  if (args.growth_monthly !== undefined) {
    const now = Number(model.demand?.growth_monthly ?? 0);
    if (same(now, args.growth_monthly)) unchanged.push(`Demand growth: already ${args.growth_monthly} a month`);
    else proposals.push(proposal("demand_settings", null, { set: { growth_monthly: args.growth_monthly } }, top));
  }
  return { proposals, unchanged };
}
