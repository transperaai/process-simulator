// Detected issues (docs/PRD.md §4.1 "Issues register", §6.4; issue #17).
//
// After every run the engine lists what looks wrong with the model: a role or
// person that is too busy, a queue that keeps growing, work waiting too long
// for someone to pick it up, a step only one person can do, rework, and missed
// deadlines. Each finding is rated Great, Good, Bad or Operational risk by the
// rating model (ratings.ts, docs/analysis-rules.md); Great ones aren't listed.
// Each finding has a stable
// `key` ("capacity:role:<role id>", "spof:step:<step id>"), built from what
// it is about and never from the numbers, so the same model gives the same
// keys run after run and a promoted issue can be matched to its detection.
//
// Everything here is a pure function of the model and one simulation result:
// no I/O, no clock, no randomness and no language model. Titles and evidence
// are filled in from fixed templates, so every number in them comes straight
// from the run. Where a what-if would test the obvious fix, the issue carries
// it as scenario patches (`fix`), which the app can run and compare.

import type { EngineModel, EnginePerson, EngineStep, SimulationResult } from "./model";
import { churnRiskIssues } from "./churn-issues";
import { overtimeIssues } from "./overtime-issues";
import {
  compareRatingsDesc,
  escalationNote,
  fixedRating,
  ratingFields,
  rateRule,
  resolveRatingConfig,
  resolveRule,
  type Rating,
  type RatingConfig,
  type RatingConfigInput,
  type RatingEscalation,
  type RatingRuleId,
  type RatingSubject,
} from "./ratings";
import { offeredLoad, type ScenarioPatch } from "./scenario";
import { servicingLinks, servicingStepIds } from "./servicing";

/** Issue types (docs/PRD.md §5 `issues.type`). Detectors use a subset; the rest are logged by hand. */
export const ISSUE_TYPES = [
  "bottleneck",
  "spof",
  "manual",
  "delay",
  "failure",
  "idea",
  "capacity",
  "sla",
  "churn_risk",
  "perception_gap",
  "broken_scenario",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/** A what-if that tests the obvious fix: patches in the scenario grammar (scenario.ts). */
export interface SuggestedFix {
  name: string;
  patch: ScenarioPatch[];
}

export interface DetectedIssue {
  /** Stable across runs of an unchanged model: `<detector>:<subject kind>:<id>`. */
  key: string;
  type: IssueType;
  /** Never Great: a Great finding isn't an issue. */
  rating: Rating;
  /** How the rating was reached: the average's band, and what raised it. */
  escalation: RatingEscalation;
  title: string;
  /** One or two templated sentences with the numbers behind the finding. */
  evidence: string;
  /** The numbers behind the finding, for the register's metric snapshot. */
  metrics: Record<string, number>;
  /** Step it shows on; for a role or person, the step where they carry the most work. */
  stepId: string | null;
  roleId: string | null;
  personId: string | null;
  fix: SuggestedFix | null;
  /** The saved scenario it is about (`broken_scenario` issues, see broken.ts). */
  scenarioId?: string | null;
  /** The client it is about (`churn_risk` issues, see churn-issues.ts). */
  clientId?: string | null;
}

/** The detectors, in the order their issues are listed within a rating. */
export const DETECTORS = ["capacity", "overtime", "queue", "wait", "spof", "rework", "sla", "churn"] as const;
export type Detector = (typeof DETECTORS)[number];

const LOCALE = "en-GB";
const num = (v: number, digits = 1) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const pct = (share: number) => `${Math.round(share * 100)}%`;
const days = (hours: number, hoursPerDay: number) => {
  const d = num(hours / hoursPerDay);
  return `${d} working day${d === "1" ? "" : "s"}`;
};

/** Who can work a step, as the engine dispatches it (simulate.ts `canDo`). */
function eligible(personId: string, p: EnginePerson, s: EngineStep): boolean {
  if (s.person) return s.person === personId;
  if (p.skills) return p.skills.includes(s.id);
  return s.role !== null && p.roles.includes(s.role);
}

export interface DetectOptions {
  /** The process the model is, for overrides set on a process. Servicing steps use their servicing process's id. */
  processId?: string | null;
}

/**
 * The issues a run points at, most severe first (then in `DETECTORS` order,
 * then by key). `result` must come from simulating `model`. `ratingConfig` is
 * the workspace's analysis rules (ratings.ts): any part left out takes the
 * agreed defaults. Pure, so a stored run can be re-rated with a new config
 * without simulating again.
 */
export function detectIssues(
  model: EngineModel,
  result: SimulationResult,
  ratingConfig: RatingConfigInput | RatingConfig = {},
  options: DetectOptions = {},
): DetectedIssue[] {
  const config = resolveRatingConfig(ratingConfig);
  const hoursPerDay = model.hoursPerWeek / 5;
  const people = result.resolvedPeople;
  const named = Boolean(model.people && Object.keys(model.people).length);
  const load = offeredLoad(model);
  const staffed = model.steps.filter((s) => s.role || s.person);
  const roleName = (id: string) => model.roles[id]?.name ?? "a role";
  const out: (DetectedIssue & { detector: Detector })[] = [];

  // Which process and services a step belongs to, for overrides.
  const servicing = servicingStepIds(model);
  const stepContext = (stepId: string): Pick<RatingSubject, "processId" | "serviceIds"> => {
    const procs = Object.entries(model.servicingProcesses ?? {}).filter(([, p]) => p.steps.includes(stepId));
    if (!procs.length) return { processId: options.processId ?? null, serviceIds: [] };
    const serviceIds = Object.entries(model.services ?? {})
      .filter(([, sv]) => servicingLinks(model, sv).some((l) => procs.some(([pid]) => pid === l.process)))
      .map(([id]) => id)
      .sort();
    return { processId: procs[0]![0], serviceIds };
  };

  /** The step in `steps` that asks for the most hands-on hours (first by id on a tie). */
  const heaviest = (steps: EngineStep[]): string | null => {
    let best: string | null = null;
    for (const s of [...steps].sort((a, b) => cmp(a.id, b.id))) {
      if (best === null || load.stepHours[s.id]! > load.stepHours[best]!) best = s.id;
    }
    return best;
  };
  const hire = (roleId: string): SuggestedFix => ({
    name: `Hire another ${roleName(roleId)}`,
    patch: [{ path: `roles.${roleId}.headcount`, op: "add", value: 1 }],
  });
  /** The role that works a step: its own, or its pinned person's first. */
  const roleOf = (s: EngineStep) => s.role ?? (s.person ? (people[s.person]?.roles[0] ?? null) : null);
  const rate = (rule: RatingRuleId, subject: RatingSubject, average: number, p90: number | null | undefined, onBottleneck: boolean) => {
    const resolved = resolveRule(config, rule, subject);
    return { resolved, outcome: resolved.enabled ? rateRule(config, rule, resolved, { average, p90, onBottleneck }) : null };
  };

  // --- Too busy (rule 1): roles, then people whose load isn't already explained by their role.
  // Client work alone is over capacity when it exceeds even the overtime cap
  // allows (docs/PRD.md §6.3.4): the run clamps to the floor, so utilisation
  // alone rates it Operational risk, and the title says why.
  const aloneAt = 1 + Math.max(0, model.overtimeCap ?? 0);
  const overCap = aloneAt > 1 ? " even with overtime" : "";
  const roleCapacity: Record<string, number> = {};
  for (const p of Object.values(people)) {
    for (const rid of p.roles) roleCapacity[rid] = (roleCapacity[rid] ?? 0) + p.capacity / p.roles.length;
  }
  const flaggedRoles = new Set<string>();
  for (const rid of Object.keys(model.roles).sort()) {
    const r = result.roles[rid];
    const range = result.kpi.roles[rid]?.util;
    const cap = roleCapacity[rid] ?? 0;
    if (!r || !(cap > 0)) continue;
    const members = Object.keys(people).filter((pid) => people[pid]!.roles.includes(rid));
    const only = members.length === 1 ? members[0]! : null;
    const personId = named && only ? only : null;
    const { resolved, outcome } = rate("busy", { roleId: rid, personId }, r.util, range?.p90, rid === result.bnRole);
    if (!outcome || outcome.rating === "great") continue;
    flaggedRoles.add(rid);
    const who = named && only ? ` (${people[only]!.name})` : "";
    const clientsAlone = r.ongoing >= aloneAt;
    out.push({
      detector: "capacity",
      key: `capacity:role:${rid}`,
      type: "capacity",
      ...ratingFields(outcome),
      title: clientsAlone
        ? `${roleName(rid)}${who}: client work alone exceeds capacity${overCap}`
        : `${roleName(rid)}${who} at ${pct(r.util)} utilisation`,
      evidence: (
        `Simulated: ${num(r.ongoingHours + r.servicingHours)} h/wk client work + ${num(r.pipelineHours)} h/wk pipeline work against ` +
        `${num(cap)} h/wk capacity (${pct(r.util)}${range ? `, range ${pct(range.p10)}–${pct(range.p90)}` : ""}). ` +
        `Cut-offs: ${resolved.cutoffs.map(pct).join(" / ")}. ${escalationNote(outcome)}`
      ).trim(),
      metrics: {
        utilisation: r.util,
        ...(range ? { utilisation_p10: range.p10, utilisation_p90: range.p90 } : {}),
        pipeline_hours_week: r.pipelineHours,
        ongoing_hours_week: r.ongoingHours,
        ...(r.servicingHours ? { servicing_hours_week: r.servicingHours } : {}),
        capacity_hours_week: cap,
      },
      stepId: heaviest(staffed.filter((s) => roleOf(s) === rid)),
      roleId: rid,
      personId,
      fix: hire(rid),
    });
  }
  for (const pid of Object.keys(people).sort()) {
    const p = people[pid]!;
    const r = result.people[pid];
    const range = result.kpi.people[pid]?.util;
    if (!r || !(p.capacity > 0)) continue;
    const main = p.roles[0] ?? null;
    const { resolved, outcome } = rate("busy", { personId: named ? pid : null, roleId: main }, r.util, range?.p90, pid === result.bnPerson);
    if (!outcome || outcome.rating === "great") continue;
    // Their role is flagged already: that issue names them when they are its
    // only member. Unless their own client work alone is over capacity and
    // the role's isn't (one person's roster can be, while the role's isn't).
    const alone = r.ongoing >= aloneAt;
    const roleAlone = p.roles.some((rid) => (result.roles[rid]?.ongoing ?? 0) >= aloneAt);
    if (p.roles.length && p.roles.every((rid) => flaggedRoles.has(rid)) && !(alone && !roleAlone)) continue;
    const mine = staffed.filter((s) => eligible(pid, p, s));
    const who = named ? p.name : `One ${main ? roleName(main) : "person"}`;
    out.push({
      detector: "capacity",
      key: `capacity:person:${pid}`,
      type: "capacity",
      ...ratingFields(outcome),
      title: alone ? `${who}: client work alone exceeds capacity${overCap}` : `${who} at ${pct(r.util)} utilisation`,
      evidence: (
        `Simulated: ${num(r.ongoingHours + r.servicingHours)} h/wk client work + ${num(r.pipelineHours)} h/wk pipeline work against ` +
        `${num(p.capacity)} h/wk capacity (${pct(r.util)}${range ? `, range ${pct(range.p10)}–${pct(range.p90)}` : ""}), ` +
        `while the rest of their role has room. Cut-offs: ${resolved.cutoffs.map(pct).join(" / ")}. ${escalationNote(outcome)}`
      ).trim(),
      metrics: {
        utilisation: r.util,
        ...(range ? { utilisation_p10: range.p10, utilisation_p90: range.p90 } : {}),
        pipeline_hours_week: r.pipelineHours,
        ongoing_hours_week: r.ongoingHours,
        ...(r.servicingHours ? { servicing_hours_week: r.servicingHours } : {}),
        capacity_hours_week: p.capacity,
      },
      stepId: heaviest(mine),
      roleId: main,
      personId: named ? pid : null,
      fix: main ? hire(main) : null,
    });
  }

  // --- Overtime worked to keep up with client work (rule 3; docs/PRD.md §4.1, decision D7).
  for (const issue of overtimeIssues(model, result, config)) out.push({ detector: "overtime", ...issue });

  // --- Per step: work piling up (4), waiting too long (5), single point of failure, rework (6), missed deadlines (7).
  for (const s of [...model.steps].sort((a, b) => cmp(a.id, b.id))) {
    const st = result.steps[s.id];
    if (!st) continue;
    const rid = roleOf(s);
    /** Hire into the step's role; for a step pinned to someone, take hands-on time down instead. */
    const capacityFix = (): SuggestedFix | null =>
      s.role
        ? hire(s.role)
        : s.work > 0
          ? { name: `Cut hands-on time at ${s.name} by 30%`, patch: [{ path: `steps.${s.id}.work_hours`, op: "multiply", value: 0.7 }] }
          : null;
    const base = { stepId: s.id, roleId: rid, personId: s.person && named ? s.person : null };
    const subject: RatingSubject = { stepId: s.id, roleId: rid, personId: base.personId, ...stepContext(s.id) };
    const onBn = s.id === result.bnStep;

    const growth = rate("queue", subject, st.queueGrowth, null, onBn);
    const growing = Boolean(s.role || s.person) && growth.outcome !== null && growth.outcome.rating !== "great";
    if (growing && growth.outcome) {
      out.push({
        detector: "queue",
        key: `queue:step:${s.id}`,
        type: "bottleneck",
        ...ratingFields(growth.outcome),
        title: `The queue at ${s.name} keeps growing`,
        evidence:
          `Simulated: the queue grows by ${num(st.queueGrowth)} items a week and ends the run at ${num(st.wip)} ` +
          `(average ${num(st.avgQueue)}, average wait ${days(st.avgWait, hoursPerDay)}). ` +
          `More work arrives than ${rid ? roleName(rid) : "its people"} can clear, so it won't settle.`,
        metrics: { queue_growth_week: st.queueGrowth, queue_end: st.wip, avg_queue: st.avgQueue, avg_wait_hours: st.avgWait },
        ...base,
        fix: capacityFix(),
      });
    } else if (s.role || s.person) {
      // A growing queue's wait is unbounded; that issue covers it. Wait means
      // time queued for a person, not the step's built-in wait.
      const resolved = resolveRule(config, "wait", subject);
      // Expected wait, most specific first: a person or step override, the
      // step's own setting, a role, service or process override, then the
      // default: 1 working day for pipeline steps, 2 for servicing steps.
      const specific = resolved.expectedWaitFrom === "person" || resolved.expectedWaitFrom === "step";
      const defaultDays = servicing.has(s.id) ? config.expectedWaitDays.servicing : config.expectedWaitDays.pipeline;
      const expected = (specific ? resolved.expectedWaitHours : null) ?? s.expectedWaitHours ?? resolved.expectedWaitHours ?? defaultDays * hoursPerDay;
      if (resolved.enabled && expected > 0) {
        const outcome = rateRule(config, "wait", resolved, {
          average: st.avgWait / expected,
          p90: st.p90 ? st.p90.avgWait / expected : null,
          onBottleneck: onBn,
        });
        if (outcome.rating !== "great") {
          out.push({
            detector: "wait",
            key: `wait:step:${s.id}`,
            type: "delay",
            ...ratingFields(outcome),
            title: `Work waits ${days(st.avgWait, hoursPerDay)} for ${s.name}`,
            evidence: (
              `Simulated: items queue ${num(st.avgWait)} h on average before anyone starts them, ` +
              `${num(st.avgWait / expected)}× the ${num(expected)} h expected for this step; average queue ${num(st.avgQueue)}, peak ${num(st.maxQueue)}. ${escalationNote(outcome)}`
            ).trim(),
            metrics: {
              avg_wait_hours: st.avgWait,
              ...(st.p90 ? { avg_wait_hours_p90: st.p90.avgWait } : {}),
              avg_queue: st.avgQueue,
              max_queue: st.maxQueue,
              expected_wait_hours: expected,
              wait_ratio: st.avgWait / expected,
            },
            ...base,
            fix: capacityFix(),
          });
        }
      }
    }

    if ((s.role || s.person) && st.arrivals > 0) {
      const who = Object.keys(people).filter((pid) => people[pid]!.capacity > 0 && eligible(pid, people[pid]!, s));
      if (who.length === 1) {
        const pid = who[0]!;
        const util = result.people[pid]?.util ?? 0;
        // Not yet on the rating model (rule 8, the absence test, will replace it): Bad when the person is also past the Bad cut-off for busy, else Good.
        const busyBad = resolveRule(config, "busy", { personId: named ? pid : null, roleId: rid }).cutoffs[1];
        out.push({
          detector: "spof",
          key: `spof:step:${s.id}`,
          type: "spof",
          ...fixedRating(util > busyBad ? "bad" : "good"),
          title: named ? `Only ${people[pid]!.name} can do ${s.name}` : `Only one ${rid ? roleName(rid) : "person"} can do ${s.name}`,
          evidence:
            `Structural: ${num(st.arrivals)} items reach this step over the ${num(model.horizonWeeks, 0)}-week run and nobody else can pick them up when ` +
            `${named ? people[pid]!.name : "they"} ${named ? "is" : "are"} away (${pct(util)} utilised).`,
          metrics: { arrivals: st.arrivals, people: 1, utilisation: util },
          stepId: s.id,
          roleId: rid,
          personId: named ? pid : null,
          fix: s.role ? hire(s.role) : null,
        });
      }
    }

    // Rework is rated from what the simulation shows, not from the rate typed into the model.
    if (st.departures > 0) {
      const observed = Math.min(1, st.reworks / st.departures);
      const { resolved, outcome } = rate("rework", subject, observed, st.p90?.reworkShare, onBn);
      if (outcome && outcome.rating !== "great") {
        out.push({
          detector: "rework",
          key: `rework:step:${s.id}`,
          type: "failure",
          ...ratingFields(outcome),
          title: `${pct(observed)} of ${s.name} is done twice`,
          evidence: (
            `Simulated: ${num(st.reworks)} repeats over the ${num(model.horizonWeeks, 0)}-week run, ${pct(observed)} of visits ` +
            `(the model enters ${pct(s.rework)}). Cut-offs: ${resolved.cutoffs.map(pct).join(" / ")}. ${escalationNote(outcome)}`
          ).trim(),
          metrics: {
            rework_rate: s.rework,
            reworks: st.reworks,
            observed_share: observed,
            ...(st.p90 ? { observed_share_p90: st.p90.reworkShare } : {}),
          },
          ...base,
          fix: { name: `Halve rework at ${s.name}`, patch: [{ path: `steps.${s.id}.rework_rate`, op: "multiply", value: 0.5 }] },
        });
      }
    }

    if (s.sla !== undefined && st.departures > 0) {
      const share = st.slaBreaches / st.departures;
      const { resolved, outcome } = rate("sla", subject, share, st.p90?.slaBreachShare, onBn);
      if (outcome && outcome.rating !== "great") {
        // Most of the time spent queueing: more hands help. Most of it an external wait: shorten that.
        const queueing = st.avgWait >= s.wait;
        out.push({
          detector: "sla",
          key: `sla:step:${s.id}`,
          type: "sla",
          ...ratingFields(outcome),
          title: `${s.name} misses its ${num(s.sla)} h SLA ${pct(share)} of the time`,
          evidence: (
            `Simulated: ${num(st.slaBreaches)} of ${num(st.departures)} visits over the ${num(model.horizonWeeks, 0)}-week run took longer than ${num(s.sla)} h ` +
            `(queue ${num(st.avgWait)} h + hands-on ${num(s.work)} h + wait ${num(s.wait)} h on average). ` +
            `Cut-offs: ${resolved.cutoffs.map(pct).join(" / ")}. ${escalationNote(outcome)}`
          ).trim(),
          metrics: {
            breach_share: share,
            ...(st.p90 ? { breach_share_p90: st.p90.slaBreachShare } : {}),
            breaches: st.slaBreaches,
            departures: st.departures,
            sla_hours: s.sla,
            avg_wait_hours: st.avgWait,
          },
          ...base,
          fix:
            queueing || !(s.wait > 0)
              ? capacityFix()
              : { name: `Halve the wait at ${s.name}`, patch: [{ path: `steps.${s.id}.wait_hours`, op: "multiply", value: 0.5 }] },
        });
      }
    }
  }

  // --- Clients whose health ends the run below 50 (docs/PRD.md §6.3.5). Not yet on the rating model (rules 9 and 10).
  for (const issue of churnRiskIssues(model, result)) out.push({ detector: "churn", ...issue });

  const rank = (i: { detector: Detector }) => DETECTORS.indexOf(i.detector);
  return out
    .sort((a, b) => compareRatingsDesc(a.rating, b.rating) || rank(a) - rank(b) || cmp(a.key, b.key))
    .map(({ detector: _detector, ...issue }) => issue);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
