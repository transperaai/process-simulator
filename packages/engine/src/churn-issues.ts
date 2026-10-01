// Detected churn risk (docs/PRD.md §4.1 "Issues register", §6.3.5, §13 "Client
// at risk"; issue #19). A roster client whose simulated health ends the run
// below 50 is at risk: servicing that runs late or is missed has worn it
// down (or it started there and nothing lifted it). One issue per client,
// keyed `churn_risk:client:<id>`, naming the work behind it and who does it.

import type { DetectedIssue } from "./issues";
import type { EngineModel, EngineStep, SimulationResult } from "./model";
import { fixedRating } from "./ratings";
import { AT_RISK_HEALTH, clientChurnSensitivity, servicingLinks } from "./servicing";
import { clientChurnMonthly, clientHealthSummary, groupServiceOf, withClientGroups } from "./clients";

const LOCALE = "en-GB";
const num = (v: number, digits = 1) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const pct = (share: number) => `${Math.round(share * 100)}%`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Churn-risk issues for a run of `model`, by client id. */
export function churnRiskIssues(source: EngineModel, result: SimulationResult): DetectedIssue[] {
  const model = withClientGroups(source);
  const clients = result.clients;
  if (!clients || !model.clients) return [];
  const named = Boolean(model.people && Object.keys(model.people).length);
  const weeks = model.horizonWeeks;
  const stepById = new Map(model.steps.map((s) => [s.id, s]));
  const out: DetectedIssue[] = [];

  for (const cid of Object.keys(clients).sort(cmp)) {
    const c = clients[cid]!;
    const client = model.clients[cid];
    // Unnamed clients of a group are reported together below, not one by one.
    if (!client || groupServiceOf(cid) !== null || !(c.health.mean < AT_RISK_HEALTH)) continue;
    const start = c.trajectory[0] ?? c.health.mean;
    const end = c.health.mean;
    const t = c.touchpoints;
    const base = clientChurnMonthly(model, client);
    const sensitivity = clientChurnSensitivity(model, client);

    // The work behind it: the heaviest staffed step of its servicing processes, and who does it for this client.
    let step: EngineStep | null = null;
    for (const sid of client.services) {
      const service = model.services?.[sid];
      if (!service) continue;
      for (const link of servicingLinks(model, service)) {
        for (const id of model.servicingProcesses![link.process]!.steps) {
          const s = stepById.get(id);
          if (s && s.role && (!step || s.work > step.work || (s.work === step.work && s.id < step.id))) step = s;
        }
      }
    }
    const roleId = step?.role ?? null;
    const assignee = roleId ? client.assignments[roleId] : undefined;
    const personId = named && assignee && model.people?.[assignee] ? assignee : null;

    const serviced = t.onTime + t.late + t.missed > 0;
    const trend = end < start - 0.5 ? `falls from ${num(start, 0)} to ${num(end, 0)}` : `stays at ${num(end, 0)}`;
    out.push({
      key: `churn_risk:client:${cid}`,
      type: "churn_risk",
      // Not yet on the rating model (rules 9 and 10 replace it): the old bands, as ratings.
      ...fixedRating(end < 30 || c.churned >= 0.5 ? "risk" : end < 40 ? "bad" : "good"),
      title: `${client.name}: health ${trend}, at risk of churning`,
      evidence:
        `Simulated: health ${trend} over the ${num(weeks, 0)}-week run (range ${num(c.health.p10, 0)}–${num(c.health.p90, 0)}; below ${AT_RISK_HEALTH} is at risk). ` +
        (serviced
          ? `Servicing touchpoints per run: ${num(t.onTime)} on time, ${num(t.late)} late, ${num(t.missed)} missed. `
          : "None of its services has a servicing process, so nothing moves its health. ") +
        `Monthly churn risk ${pct(c.churnMonthly.mean)} (base ${pct(base)}${sensitivity > 0 ? `, sensitivity ${num(sensitivity)}` : ""}); ` +
        `it churned in ${pct(c.churned)} of runs.` +
        (step && serviced ? ` Most of its servicing work is ${step.name}${personId ? `, done by ${model.people![personId]!.name}` : ""}.` : ""),
      metrics: {
        health: end,
        health_start: start,
        health_p10: c.health.p10,
        health_p90: c.health.p90,
        touchpoints_on_time: t.onTime,
        touchpoints_late: t.late,
        touchpoints_missed: t.missed,
        churn_monthly: c.churnMonthly.mean,
        churned_share: c.churned,
      },
      stepId: step?.id ?? null,
      roleId,
      personId,
      clientId: cid,
      fix: roleId && serviced
        ? { name: `Hire another ${model.roles[roleId]?.name ?? "person"}`, patch: [{ path: `roles.${roleId}.headcount`, op: "add", value: 1 }] }
        : null,
    });
  }

  // Client groups: one issue per group rated Bad or Operational risk (rule 9), keyed by its service.
  for (const group of clientHealthSummary(model, result).groups) {
    // Rule 9: a group rated Bad or Operational risk (health under 65) is a finding; Good and Great are not.
    if (group.rating === "great" || group.rating === "good") continue;
    const members = Object.keys(clients).filter((k) => groupServiceOf(k) === group.service);
    const t = { onTime: 0, late: 0, missed: 0 };
    let churnMonthly = 0;
    for (const k of members) {
      const c = clients[k]!;
      t.onTime += c.touchpoints.onTime;
      t.late += c.touchpoints.late;
      t.missed += c.touchpoints.missed;
      churnMonthly += c.churnMonthly.mean;
    }
    churnMonthly /= members.length;
    const serviced = t.onTime + t.late + t.missed > 0;
    const trend = group.health < group.startHealth - 0.5 ? `falls from ${num(group.startHealth, 0)} to ${num(group.health, 0)}` : `stays at ${num(group.health, 0)}`;
    out.push({
      key: `churn_risk:group:${group.service}`,
      type: "churn_risk",
      ...fixedRating(group.rating),
      title: `${group.name} clients: health ${trend}, ${group.rating === "risk" ? "at risk of churning" : "slipping"}`,
      evidence:
        `Simulated: the average health of the ${num(group.clients, 0)} ${group.name} clients ${trend} over the ${num(weeks, 0)}-week run (Bad below 65, Operational risk below ${AT_RISK_HEALTH}). ` +
        (serviced
          ? `Servicing touchpoints per run, all of them: ${num(t.onTime)} on time, ${num(t.late)} late, ${num(t.missed)} missed. `
          : "None of its services has a servicing process, so nothing moves their health. ") +
        `Monthly churn risk ${pct(churnMonthly)}; about ${num(group.churned)} of them leave in a run.`,
      metrics: {
        health: group.health,
        health_start: group.startHealth,
        clients: group.clients,
        touchpoints_on_time: t.onTime,
        touchpoints_late: t.late,
        touchpoints_missed: t.missed,
        churn_monthly: churnMonthly,
        churned: group.churned,
      },
      stepId: null,
      roleId: null,
      personId: null,
      clientId: null,
      fix: null,
    });
  }
  return out;
}
