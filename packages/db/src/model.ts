import type { EngineModel, EngineStep } from "@flowsim/engine";
import type { ProcessBundle, StepRow } from "./types";

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
export function toEngineModel(bundle: ProcessBundle): EngineModel {
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

  return {
    horizonWeeks: s.horizon_weeks,
    hoursPerWeek: s.hours_per_week,
    leadsPerWeek: s.leads_per_week,
    activeClients: s.active_clients,
    churnMonthly: s.churn_monthly,
    retainer: s.retainer,
    roles: engineRoles,
    entry,
    sinks: { won: sinkFor("won"), lost: sinkFor("lost") },
    steps: working,
  };
}

function byIdAsc(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isWorkingStep(step: StepRow): boolean {
  return step.kind !== "start" && step.kind !== "end";
}
