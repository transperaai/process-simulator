import type { EngineModel, EnginePerson, EngineStep } from "@transpera-flow/engine";
import type { ProcessBundle, StepRow } from "./types";

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
 * - `end` steps become the engine's sinks by outcome (`won`, `lost`).
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

  const sinkFor = (outcome: "won" | "lost") => {
    const ends = steps.filter((step) => step.kind === "end" && step.outcome === outcome);
    if (ends.length > 1) throw new ModelError(`At most one '${outcome}' end step is supported, found ${ends.length}`);
    return ends[0]?.id ?? `__${outcome}__`;
  };

  const working = steps
    .filter((step) => step.kind !== "start" && step.kind !== "end")
    .sort(byIdAsc)
    .map((step): EngineStep => {
      const next = edges
        .filter((e) => e.from_step_id === step.id)
        .sort(byIdAsc)
        .map((e) => ({ to: e.to_step_id, p: Number(e.probability) }));
      if (!next.length) throw new ModelError(`Step '${step.name}' has no outgoing edge`);
      for (const n of next) if (!byId.has(n.to)) throw new ModelError(`Edge from '${step.name}' points at a missing step`);
      return {
        id: step.id,
        name: step.name,
        role: step.role_id,
        ...(step.person_id ? { person: step.person_id } : {}),
        work: Number(step.work_hours),
        wait: Number(step.wait_hours),
        rework: Number(step.rework_rate),
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
    ...(people ? { people } : {}),
    ...(s.availability_floor !== undefined ? { availabilityFloor: s.availability_floor } : {}),
    entry,
    sinks: { won: sinkFor("won"), lost: sinkFor("lost") },
    steps: working,
  };
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

function byIdAsc(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isWorkingStep(step: StepRow): boolean {
  return step.kind !== "start" && step.kind !== "end";
}
