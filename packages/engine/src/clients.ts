// Client roster load (docs/PRD.md §6.3.4, decision D13; issue #18).
//
// With a roster, ongoing client work is per client: each client needs some
// hours a week from each role, and those hours go to the person assigned to
// it for that role. Pure functions of the model, shared by the simulation
// (which re-applies them as clients are won and churn) and the app (which
// shows each person's starting load without running anything).

import type { EngineClient, EngineModel, EnginePerson } from "./model";

/** Weeks in a month for monthly loads, as elsewhere in the engine (4.33). */
export const LOAD_WEEKS_PER_MONTH = 4.33;

/**
 * Hours a week a client needs from each role id. For each of its services
 * that has a fallback ongoing load: that service's hours per month / 4.33.
 * When none of its services has one (or it has no services the model knows),
 * the roles' `ongoing` hours per client a week, as the pooled model uses.
 * Roles the model doesn't have, and zero loads, are left out.
 */
export function clientRoleLoads(model: EngineModel, client: Pick<EngineClient, "services">): Record<string, number> {
  const out: Record<string, number> = {};
  let fromServices = false;
  for (const sid of client.services) {
    const fallback = model.services?.[sid]?.fallbackOngoing;
    if (!fallback) continue;
    fromServices = true;
    for (const rid of Object.keys(fallback).sort()) {
      const monthly = fallback[rid]!;
      if (!(rid in model.roles) || !(monthly > 0)) continue;
      out[rid] = (out[rid] ?? 0) + monthly / LOAD_WEEKS_PER_MONTH;
    }
  }
  if (!fromServices) {
    for (const rid in model.roles) {
      const weekly = model.roles[rid]!.ongoing || 0;
      if (weekly > 0) out[rid] = weekly;
    }
  }
  return out;
}

/** Monthly churn of a client: the mean of its known services' base churn, or the model's. */
export function clientChurnMonthly(model: EngineModel, client: Pick<EngineClient, "services">): number {
  const known = client.services.map((sid) => model.services?.[sid]).filter((sv) => sv !== undefined);
  if (!known.length) return model.churnMonthly;
  return known.reduce((sum, sv) => sum + sv.churnMonthly, 0) / known.length;
}

/** Someone carrying a share of a role's load for a client. */
export interface Carrier {
  person: string;
  share: number;
}

/**
 * Members of each role who can carry pooled load (capacity above 0), in
 * people order, with their share: capacity split evenly across their roles,
 * over the role's total. The same split as the pooled `ongoing` load.
 */
export function rolePools(model: EngineModel, people: Record<string, EnginePerson>): Record<string, Carrier[]> {
  const pools: Record<string, Carrier[]> = {};
  for (const rid in model.roles) {
    const members = Object.entries(people).filter(([, p]) => p.capacity > 0 && p.roles.includes(rid));
    const total = members.reduce((sum, [, p]) => sum + p.capacity / p.roles.length, 0);
    pools[rid] = total > 0 ? members.map(([id, p]) => ({ person: id, share: p.capacity / p.roles.length / total })) : [];
  }
  return pools;
}

/** Who carries a client's load for a role: its assignee if the model has them, otherwise the role's pool. */
export function carriersFor(
  pools: Record<string, Carrier[]>,
  people: Record<string, EnginePerson>,
  roleId: string,
  assignee: string | undefined,
): Carrier[] {
  if (assignee !== undefined && assignee in people) return [{ person: assignee, share: 1 }];
  return pools[roleId] ?? [];
}

/** A person's starting load from the roster. */
export interface PersonLoad {
  /** Ongoing client hours a week, all roles together. */
  hours: number;
  /** The same by role id. */
  byRole: Record<string, number>;
  /** Clients assigned to them in any role (pooled load doesn't count). */
  clients: number;
}

/**
 * Each person's ongoing load from the roster as it stands (before anything
 * is won or churns): what the simulation starts from. Empty without a roster.
 */
export function rosterLoads(model: EngineModel, people: Record<string, EnginePerson>): Record<string, PersonLoad> {
  const out: Record<string, PersonLoad> = {};
  for (const pid in people) out[pid] = { hours: 0, byRole: {}, clients: 0 };
  if (!model.clients) return out;
  const pools = rolePools(model, people);
  for (const cid of Object.keys(model.clients)) {
    const client = model.clients[cid]!;
    const loads = clientRoleLoads(model, client);
    for (const rid in loads) {
      for (const c of carriersFor(pools, people, rid, client.assignments[rid])) {
        const load = out[c.person]!;
        const hours = loads[rid]! * c.share;
        load.hours += hours;
        load.byRole[rid] = (load.byRole[rid] ?? 0) + hours;
      }
    }
    for (const pid of new Set(Object.values(client.assignments))) if (pid in out) out[pid]!.clients++;
  }
  return out;
}
