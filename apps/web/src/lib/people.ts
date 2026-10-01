// What the People page shows, worked out from a run (issue #120). Pure, so it can be unit tested.

import type { EngineModel, SimulationResult } from "@transpera-flow/engine";

/** A person whose utilisation at or above this in a bad month (the 90th percentile) counts as too busy; as on the rating model's busy rule. */
export const BUSY_LIMIT = 0.85;

export interface PersonBusy {
  id: string;
  name: string;
  /** Role names, comma separated. */
  role: string;
  /** Full-time equivalent from the person's record; null when the model made the person up from a role's head-count. */
  fte: number | null;
  /** Average utilisation over the runs, 0 to 1 and a bit above with overtime. */
  average: number;
  /** A bad month: the 90th percentile over the runs. */
  p90: number;
}

/** Everyone in the run with their average and P90 utilisation, grouped by their first role in role order, then by name. */
export function personRows(model: EngineModel, result: SimulationResult, fteById: ReadonlyMap<string, number>): PersonBusy[] {
  const roleOrder = Object.keys(model.roles);
  return Object.entries(result.resolvedPeople)
    .flatMap(([id, p]) => {
      const band = result.kpi.people[id];
      if (!band) return [];
      return [
        {
          id,
          name: p.name,
          role: p.roles.map((rid) => model.roles[rid]?.name).filter(Boolean).join(", "),
          fte: fteById.get(id) ?? null,
          average: band.util.mean,
          p90: band.util.p90,
          first: roleOrder.indexOf(p.roles[0] ?? ""),
        },
      ];
    })
    .sort((a, b) => a.first - b.first || a.name.localeCompare(b.name))
    .map(({ first: _first, ...row }) => row);
}

export interface TeamSummary {
  people: number;
  /** Total full-time equivalents of the people who have one on record; null when none do. */
  fte: number | null;
  /** People whose bad month (P90) is above the busy limit. */
  busyInBadMonth: number;
}

export function teamSummary(rows: readonly PersonBusy[]): TeamSummary {
  const withFte = rows.filter((r) => r.fte !== null);
  return {
    people: rows.length,
    fte: withFte.length ? withFte.reduce((a, r) => a + r.fte!, 0) : null,
    busyInBadMonth: rows.filter((r) => r.p90 > BUSY_LIMIT).length,
  };
}
