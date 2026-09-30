import {
  isFlatDemand,
  type EngineDemand,
  type Distribution as EngineDistribution,
  type EngineClient,
  type EngineEnd,
  type EngineModel,
  type EnginePerson,
  type EngineService,
  type EngineStep,
} from "@transpera-flow/engine";
import type { DistParams, Distribution, LeadSourceRow, ProcessBundle, SeasonalityRow, StepRow } from "./types";

const WORKING_DAYS_PER_WEEK = 5;
const DAY_MS = 86_400_000;

/** Working days (Mon–Fri) from `from` up to, not including, `to`. Negative if `to` is earlier. */
export function workingDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (b < a) return -workingDaysBetween(to, from);
  let days = 0;
  for (let t = a; t < b; t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

export interface ModelOptions {
  /** ISO date the simulation starts on; leave and start/end dates are measured from it. Defaults to today. */
  startDate?: string;
}

export class ModelError extends Error {}

/**
 * Resolve a stored process revision into the engine's model.
 *
 * - The single `start` step marks the entry: its one outgoing edge points at
 *   the first real step.
 * - `end` steps by outcome: the first `won` and first `lost` (by id) become
 *   the engine's sinks; any further `won`/`lost` ends and every `done` end go
 *   to `ends`.
 * - Services (see `engineServices`) and, only when there are some, the edges'
 *   condition tags. A process with no services maps exactly as it did before
 *   services existed.
 * - Arrivals (see `arrivalsPerWeek` and `engineDemand`): the lead sources'
 *   qualified leads split by the services mix, with seasonality and growth
 *   placed in the calendar from the start date. Flat demand is left out.
 * - The client roster (see `engineClients`) and the overtime cap. A
 *   workspace with no clients maps exactly as before the roster existed.
 * - Steps and roles are ordered by id so the result, and therefore the
 *   simulation, doesn't depend on database row order.
 */
export function toEngineModel(bundle: ProcessBundle, options: ModelOptions = {}): EngineModel {
  const { workspace, roles, steps, edges } = bundle;
  const s = workspace.settings;
  const byId = new Map(steps.map((step) => [step.id, step]));

  const starts = steps.filter((step) => step.kind === "start");
  if (starts.length !== 1) throw new ModelError(`Process needs exactly one start step, found ${starts.length}`);
  const startEdges = edges.filter((e) => e.from_step_id === starts[0]!.id);
  if (startEdges.length !== 1) throw new ModelError("The start step needs exactly one outgoing edge");
  const entry = startEdges[0]!.to_step_id;

  /** An edge may lead to a working step or an end step (any outcome); anything else would strand items in the engine. */
  const checkTarget = (from: string, to: string) => {
    const target = byId.get(to);
    if (!target) throw new ModelError(`Edge from '${from}' points at a missing step`);
    if (target.kind === "start") throw new ModelError(`Edge from '${from}' leads back to the start step`);
  };
  checkTarget(starts[0]!.name, entry);

  const endSteps = steps.filter((step) => step.kind === "end").sort(byIdAsc);
  const sinkFor = (outcome: "won" | "lost") => endSteps.find((step) => step.outcome === outcome)?.id ?? `__${outcome}__`;
  const sinks = { won: sinkFor("won"), lost: sinkFor("lost") };
  const ends: Record<string, EngineEnd> = {};
  for (const step of endSteps) {
    // The database requires an outcome on every end step; "done" is the harmless reading of a missing one.
    if (step.id !== sinks.won && step.id !== sinks.lost) ends[step.id] = { outcome: step.outcome ?? "done" };
  }

  const services = engineServices(bundle);
  // Tags route only entities whose service carries them, so without services they are left out.
  const tagOf = (tag: string | null) => (services && tag?.trim() ? { tag: tag.trim() } : {});

  const working = steps
    .filter((step) => step.kind !== "start" && step.kind !== "end")
    .sort(byIdAsc)
    .map((step): EngineStep => {
      const next = edges
        .filter((e) => e.from_step_id === step.id)
        .sort(byIdAsc)
        .map((e) => ({ to: e.to_step_id, p: Number(e.probability), ...tagOf(e.condition_tag) }));
      if (!next.length) throw new ModelError(`Step '${step.name}' has no outgoing edge`);
      for (const n of next) checkTarget(step.name, n.to);
      return {
        id: step.id,
        name: step.name,
        role: step.role_id,
        ...(step.person_id ? { person: step.person_id } : {}),
        work: Number(step.work_hours),
        wait: Number(step.wait_hours),
        rework: Number(step.rework_rate),
        ...optional("workDist", engineDistribution(step.work_dist, step.work_params, Number(step.work_hours))),
        ...optional("waitDist", engineDistribution(step.wait_dist, step.wait_params, Number(step.wait_hours))),
        // Entered WIP (0 included) makes the run start from it instead of a warm-up.
        ...(step.current_wip != null ? { currentWip: Number(step.current_wip) } : {}),
        // An SLA only counts breaches (detected issues); it doesn't change the run.
        ...(step.sla_hours != null ? { sla: Number(step.sla_hours) } : {}),
        next,
      };
    });

  const engineRoles: EngineModel["roles"] = {};
  for (const role of [...roles].sort(byIdAsc)) {
    engineRoles[role.id] = {
      name: role.name,
      count: role.headcount,
      cost: Number(role.default_cost_rate),
      ongoing: Number(role.ongoing_hours_per_client_week),
    };
  }

  const startDate = options.startDate ?? new Date().toISOString().slice(0, 10);
  const people = resolvePeopleRows(bundle, working, startDate);
  const demand = engineDemand(bundle, startDate);
  const clients = engineClients(bundle, services, startDate);

  return {
    horizonWeeks: s.horizon_weeks,
    hoursPerWeek: s.hours_per_week,
    leadsPerWeek: arrivalsPerWeek(bundle, services),
    ...(demand ? { demand } : {}),
    activeClients: clients ? Object.keys(clients).length : s.active_clients,
    churnMonthly: s.churn_monthly,
    retainer: s.retainer,
    roles: engineRoles,
    ...(services ? { services } : {}),
    ...(people ? { people } : {}),
    ...(s.availability_floor !== undefined ? { availabilityFloor: s.availability_floor } : {}),
    ...(s.overtime_cap !== undefined && s.overtime_cap !== null ? { overtimeCap: Number(s.overtime_cap) } : {}),
    ...(clients ? { clients } : {}),
    entry,
    sinks,
    ...(Object.keys(ends).length ? { ends } : {}),
    steps: working,
  };
}

/**
 * The engine's services for this process: the workspace's active services
 * whose arrivals enter it. PRD §5 gives a service an `entry_process_id`, not a
 * step. A service entering this process, or with none set (meaning the
 * workspace's pipeline), enters at the process's own entry step, which is the
 * engine's default, so `entry` is left out. Services entering another process
 * don't arrive here. Undefined when none apply: then the interim `retainer`
 * prices every win, as before services existed.
 */
function engineServices(bundle: ProcessBundle): Record<string, EngineService> | undefined {
  const here = bundle.services
    .filter((sv) => sv.active && (sv.entry_process_id === null || sv.entry_process_id === bundle.process.id))
    .sort(byIdAsc);
  if (!here.length) return undefined;
  if (!(here.reduce((sum, sv) => sum + Number(sv.mix_share), 0) > 0)) {
    throw new ModelError("The services' mix shares add up to 0; give at least one service a share");
  }
  const services: Record<string, EngineService> = {};
  const roleIds = new Set(bundle.roles.map((r) => r.id));
  for (const sv of here) {
    const fallback = fallbackLoad(sv.fallback_ongoing_load, roleIds);
    services[sv.id] = {
      name: sv.name,
      pricingModel: sv.pricing_model,
      price: Number(sv.price),
      margin: Number(sv.margin),
      tenureMonths: Number(sv.tenure_months),
      churnMonthly: Number(sv.churn_monthly_base),
      mixShare: Number(sv.mix_share),
      pathTags: sv.path_tags.map((t) => t.trim()).filter(Boolean),
      ...(fallback ? { fallbackOngoing: fallback } : {}),
    };
  }
  return services;
}

/**
 * A service's fallback ongoing load for the engine: hours a month by role id,
 * for the workspace's roles, in id order. Undefined when none is entered, so
 * the roles' hours per client apply (docs/PRD.md §6.3.4).
 */
function fallbackLoad(stored: unknown, roleIds: Set<string>): Record<string, number> | undefined {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  const entries = Object.entries(stored as Record<string, unknown>)
    .map(([rid, v]) => [rid, num(v)] as const)
    .filter((e): e is readonly [string, number] => roleIds.has(e[0]) && e[1] !== null && e[1] >= 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * The client roster for the engine (docs/PRD.md §6.2, decision D13): active
 * clients that had started by the start date, in id order, with the services
 * among this process's that they take and their assignments per role.
 * Services entering other processes aren't in the engine model, so a client
 * with only those carries the roles' hours per client. Undefined when the
 * workspace has no clients at all: then the interim `active_clients` count
 * applies, as before the roster existed.
 */
function engineClients(
  bundle: ProcessBundle,
  services: Record<string, EngineService> | undefined,
  startDate: string,
): Record<string, EngineClient> | undefined {
  const rows = bundle.clients ?? [];
  if (!rows.length) return undefined;
  const roleIds = new Set(bundle.roles.map((r) => r.id));
  const clients: Record<string, EngineClient> = {};
  for (const c of [...rows].sort(byIdAsc)) {
    if (!c.active || (c.start_date && c.start_date > startDate)) continue;
    const assignments: Record<string, string> = {};
    for (const a of (bundle.clientAssignments ?? [])
      .filter((a) => a.client_id === c.id && roleIds.has(a.role_id))
      .sort((a, b) => (a.role_id < b.role_id ? -1 : a.role_id > b.role_id ? 1 : 0))) {
      assignments[a.role_id] = a.person_id;
    }
    clients[c.id] = {
      name: c.name,
      services: (bundle.clientServices ?? [])
        .filter((cs) => cs.client_id === c.id && services && cs.service_id in services)
        .map((cs) => cs.service_id)
        .sort(),
      mrr: Number(c.mrr),
      ...(c.health !== null && c.health !== undefined ? { health: Number(c.health) } : {}),
      assignments,
    };
  }
  return clients;
}

/**
 * Qualified leads a week from the lead sources: Σ volume × conversion
 * (docs/PRD.md §6.2), summed in id order so the result doesn't depend on row
 * order. Null when there are none.
 */
export function qualifiedLeadsPerWeek(
  sources: readonly Pick<LeadSourceRow, "id" | "volume_week" | "conversion_to_qualified">[],
): number | null {
  if (!sources.length) return null;
  return [...sources].sort(byIdAsc).reduce((sum, src) => sum + Number(src.volume_week) * Number(src.conversion_to_qualified), 0);
}

/** The seasonality curve: twelve multipliers, January first. A month with no row is 1. */
export function seasonalityCurve(rows: readonly Pick<SeasonalityRow, "month" | "multiplier">[]): number[] {
  const curve = new Array<number>(12).fill(1);
  for (const row of rows) if (row.month >= 1 && row.month <= 12) curve[row.month - 1] = Number(row.multiplier);
  return curve;
}

/**
 * This process's arrivals a week (docs/PRD.md §6.2): the lead sources'
 * qualified leads (or, with none, the interim `settings.leads_per_week`),
 * times the share of the active services' mix that enters this process.
 * The share is exactly 1 when every active service enters here, as in a
 * single-pipeline workspace, and 0 when none does.
 */
function arrivalsPerWeek(bundle: ProcessBundle, here: Record<string, EngineService> | undefined): number {
  const total = qualifiedLeadsPerWeek(bundle.leadSources ?? []) ?? bundle.workspace.settings.leads_per_week;
  const mix = (shares: number[]) => shares.reduce((sum, m) => sum + m, 0);
  const all = mix(bundle.services.filter((sv) => sv.active).sort(byIdAsc).map((sv) => Number(sv.mix_share)));
  // No mix to split by: every arrival is this process's.
  if (!(all > 0)) return total;
  const mine = here ? mix(Object.values(here).map((sv) => sv.mixShare)) : 0;
  return mine === all ? total : (total * mine) / all;
}

/**
 * Seasonality and growth for the engine, with the start date placed in the
 * calendar (1 September is month 8; the 16th of a 30-day month is half a
 * month further on). Undefined when flat with no growth, so such a
 * workspace simulates exactly as before demand settings existed.
 */
function engineDemand(bundle: ProcessBundle, startDate: string): EngineDemand | undefined {
  const seasonality = seasonalityCurve(bundle.seasonality ?? []);
  const growth = Number(bundle.demand?.growth_monthly ?? 0);
  const [year, month, day] = startDate.split("-").map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const demand: EngineDemand = {
    ...(seasonality.some((m) => m !== 1) ? { seasonality } : {}),
    ...(growth ? { growthMonthly: growth } : {}),
    startMonth: month - 1 + (day - 1) / daysInMonth,
  };
  return isFlatDemand(demand) ? undefined : demand;
}

/**
 * Named people for the engine: active people employed on the start date, with
 * capacity from their hours (or FTE × the workspace week), their roles, the
 * steps of this process they are skilled for, and leave as simulation hours.
 * Returns undefined when the workspace has no people, so head-counts apply.
 */
function resolvePeopleRows(bundle: ProcessBundle, working: EngineStep[], startDate: string) {
  const s = bundle.workspace.settings;
  const hoursPerDay = s.hours_per_week / WORKING_DAYS_PER_WEEK;
  const roleIds = new Set(bundle.roles.map((r) => r.id));
  const stepIds = new Set(working.map((st) => st.id));
  const employed = bundle.people
    .filter((p) => p.active)
    .filter((p) => (!p.start_date || p.start_date <= startDate) && (!p.end_date || p.end_date >= startDate))
    .sort(byIdAsc);
  if (!employed.length) return undefined;

  const people: Record<string, EnginePerson> = {};
  for (const p of employed) {
    const skillRows = bundle.personSkills.filter((k) => k.person_id === p.id);
    const leave = bundle.personLeave
      .filter((l) => l.person_id === p.id)
      .map((l): [number, number] => [
        Math.max(0, workingDaysBetween(startDate, l.start_date)) * hoursPerDay,
        workingDaysBetween(startDate, nextDay(l.end_date)) * hoursPerDay,
      ])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    people[p.id] = {
      name: p.name,
      roles: bundle.personRoles
        .filter((r) => r.person_id === p.id && roleIds.has(r.role_id))
        .map((r) => r.role_id)
        .sort(),
      capacity: p.capacity_hours_week != null ? Number(p.capacity_hours_week) : Number(p.fte) * s.hours_per_week,
      ...(p.cost_rate != null ? { cost: Number(p.cost_rate) } : {}),
      ...(skillRows.length ? { skills: skillRows.map((k) => k.step_id).filter((id) => stepIds.has(id)).sort() } : {}),
      ...(leave.length ? { leave } : {}),
    };
  }
  return people;
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

/** A finite number from a jsonb value, or null. */
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * A triangular range in hours from a step's params. Missing or inconsistent
 * values fall back to half to one and a half times the mean, peaking at it.
 */
export function triangularRange(params: DistParams | null | undefined, mean: number): { min: number; mode: number; max: number } {
  const min = num(params?.min);
  const mode = num(params?.mode);
  const max = num(params?.max);
  if (min !== null && mode !== null && max !== null && min >= 0 && min <= mode && mode <= max) return { min, mode, max };
  return { min: mean * 0.5, mode: mean, max: mean * 1.5 };
}

/**
 * The engine's distribution for a stored `*_dist` and `*_params`. Undefined
 * means the engine's default (lognormal with its default spread), which is
 * what a lognormal step without a `cv` gets, so untouched rows simulate as before.
 */
export function engineDistribution(
  dist: Distribution,
  params: DistParams | null | undefined,
  mean: number,
): EngineDistribution | undefined {
  if (dist === "constant") return { kind: "constant" };
  if (dist === "triangular") return { kind: "triangular", ...triangularRange(params, mean) };
  const cv = num(params?.cv);
  return cv !== null && cv >= 0 ? { kind: "lognormal", cv } : undefined;
}

function byIdAsc(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isWorkingStep(step: StepRow): boolean {
  return step.kind !== "start" && step.kind !== "end";
}
