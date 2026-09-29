import type {
  Distribution as EngineDistribution,
  EngineEnd,
  EngineModel,
  EnginePerson,
  EngineService,
  EngineStep,
} from "@transpera-flow/engine";
import type { DistParams, Distribution, ProcessBundle, StepRow } from "./types";

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

  const people = resolvePeopleRows(bundle, working, options.startDate ?? new Date().toISOString().slice(0, 10));

  return {
    horizonWeeks: s.horizon_weeks,
    hoursPerWeek: s.hours_per_week,
    leadsPerWeek: s.leads_per_week,
    activeClients: s.active_clients,
    churnMonthly: s.churn_monthly,
    retainer: s.retainer,
    roles: engineRoles,
    ...(services ? { services } : {}),
    ...(people ? { people } : {}),
    ...(s.availability_floor !== undefined ? { availabilityFloor: s.availability_floor } : {}),
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
  for (const sv of here) {
    services[sv.id] = {
      name: sv.name,
      pricingModel: sv.pricing_model,
      price: Number(sv.price),
      margin: Number(sv.margin),
      tenureMonths: Number(sv.tenure_months),
      churnMonthly: Number(sv.churn_monthly_base),
      mixShare: Number(sv.mix_share),
      pathTags: sv.path_tags.map((t) => t.trim()).filter(Boolean),
    };
  }
  return services;
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
