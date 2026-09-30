// Detected issues (docs/PRD.md §4.1 "Issues register", §6.4; issue #17).
//
// After every run the engine lists what looks wrong with the model: a role or
// person over the utilisation threshold, a queue that keeps growing, work
// waiting too long for someone to pick it up, a step only one person can do,
// rework over the threshold, and SLA breaches. Each finding has a stable
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
import { overtimeIssues } from "./overtime-issues";
import { offeredLoad, type ScenarioPatch } from "./scenario";

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

/** Most severe first. */
export const ISSUE_SEVERITIES = ["critical", "serious", "warning", "info"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** When a detector fires (docs/PRD.md §6.2 `thresholds`). */
export interface IssueThresholds {
  /** Utilisation above which a role or person is flagged (default 0.85, the §13 ceiling). */
  utilisation: number;
  /** Average hours an item queues at a step before someone starts it (default 16, two working days). */
  waitHours: number;
  /** Rework probability at or above which a step is flagged (default 0.2). */
  reworkRate: number;
  /** Queue growth, in items per week, taken as growing without bound (default 0.5). */
  queueGrowthPerWeek: number;
  /** Share of a step's visits over its SLA that is flagged (default 0.1). */
  slaBreachShare: number;
}

export const DEFAULT_ISSUE_THRESHOLDS: IssueThresholds = {
  utilisation: 0.85,
  waitHours: 16,
  reworkRate: 0.2,
  queueGrowthPerWeek: 0.5,
  slaBreachShare: 0.1,
};

/** A what-if that tests the obvious fix: patches in the scenario grammar (scenario.ts). */
export interface SuggestedFix {
  name: string;
  patch: ScenarioPatch[];
}

export interface DetectedIssue {
  /** Stable across runs of an unchanged model: `<detector>:<subject kind>:<id>`. */
  key: string;
  type: IssueType;
  severity: IssueSeverity;
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
}

/** The detectors, in the order their issues are listed within a severity. */
export const DETECTORS = ["capacity", "overtime", "queue", "wait", "spof", "rework", "sla"] as const;
export type Detector = (typeof DETECTORS)[number];

/**
 * Utilisation above which work doesn't fit, critical. Just over 1: someone
 * working overtime within the cap is at exactly 100% of their extended week,
 * which is serious, not critical (docs/PRD.md §6.3.4).
 */
const OVER_FULL = 1 + 1e-9;

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

/**
 * The issues a run points at, most severe first (then in `DETECTORS` order,
 * then by key). `result` must come from simulating `model`.
 */
export function detectIssues(
  model: EngineModel,
  result: SimulationResult,
  thresholds: Partial<IssueThresholds> = {},
): DetectedIssue[] {
  const t = { ...DEFAULT_ISSUE_THRESHOLDS, ...thresholds };
  const hoursPerDay = model.hoursPerWeek / 5;
  const people = result.resolvedPeople;
  const named = Boolean(model.people && Object.keys(model.people).length);
  const load = offeredLoad(model);
  const staffed = model.steps.filter((s) => s.role || s.person);
  const roleName = (id: string) => model.roles[id]?.name ?? "a role";
  const out: (DetectedIssue & { detector: Detector })[] = [];

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

  // --- Capacity: roles, then people whose load isn't already explained by their role.
  // Client work alone is over capacity when it exceeds even the overtime cap
  // allows (docs/PRD.md §6.3.4): then the run clamps to the floor, critical.
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
    if (!r || !(cap > 0) || !(r.util > t.utilisation)) continue;
    flaggedRoles.add(rid);
    const members = Object.keys(people).filter((pid) => people[pid]!.roles.includes(rid));
    const who = named && members.length === 1 ? ` (${people[members[0]!]!.name})` : "";
    const clientsAlone = r.ongoing >= aloneAt;
    out.push({
      detector: "capacity",
      key: `capacity:role:${rid}`,
      type: "capacity",
      severity: clientsAlone || r.util > OVER_FULL ? "critical" : r.util >= 0.95 ? "serious" : "warning",
      title: clientsAlone
        ? `${roleName(rid)}${who}: client work alone exceeds capacity${overCap}`
        : `${roleName(rid)}${who} at ${pct(r.util)} utilisation`,
      evidence:
        `Simulated: ${num(r.ongoingHours)} h/wk client work + ${num(r.pipelineHours)} h/wk pipeline work against ` +
        `${num(cap)} h/wk capacity (${pct(r.util)}${range ? `, range ${pct(range.p10)}–${pct(range.p90)}` : ""}). ` +
        `Queues grow sharply above ${pct(t.utilisation)}.`,
      metrics: {
        utilisation: r.util,
        ...(range ? { utilisation_p10: range.p10, utilisation_p90: range.p90 } : {}),
        pipeline_hours_week: r.pipelineHours,
        ongoing_hours_week: r.ongoingHours,
        capacity_hours_week: cap,
      },
      stepId: heaviest(staffed.filter((s) => roleOf(s) === rid)),
      roleId: rid,
      personId: named && members.length === 1 ? members[0]! : null,
      fix: hire(rid),
    });
  }
  for (const pid of Object.keys(people).sort()) {
    const p = people[pid]!;
    const r = result.people[pid];
    const range = result.kpi.people[pid]?.util;
    if (!r || !(p.capacity > 0) || !(r.util > t.utilisation)) continue;
    // Their role is flagged already: that issue names them when they are its
    // only member. Unless their own client work alone is over capacity and
    // the role's isn't (one person's roster can be, while the role's isn't).
    const alone = r.ongoing >= aloneAt;
    const roleAlone = p.roles.some((rid) => (result.roles[rid]?.ongoing ?? 0) >= aloneAt);
    if (p.roles.length && p.roles.every((rid) => flaggedRoles.has(rid)) && !(alone && !roleAlone)) continue;
    const mine = staffed.filter((s) => eligible(pid, p, s));
    const main = p.roles[0] ?? null;
    const who = named ? p.name : `One ${main ? roleName(main) : "person"}`;
    out.push({
      detector: "capacity",
      key: `capacity:person:${pid}`,
      type: "capacity",
      severity: alone || r.util > OVER_FULL ? "critical" : r.util >= 0.95 ? "serious" : "warning",
      title: alone ? `${who}: client work alone exceeds capacity${overCap}` : `${who} at ${pct(r.util)} utilisation`,
      evidence:
        `Simulated: ${num(r.ongoingHours)} h/wk client work + ${num(r.pipelineHours)} h/wk pipeline work against ` +
        `${num(p.capacity)} h/wk capacity (${pct(r.util)}${range ? `, range ${pct(range.p10)}–${pct(range.p90)}` : ""}), ` +
        `while the rest of their role has room.`,
      metrics: {
        utilisation: r.util,
        ...(range ? { utilisation_p10: range.p10, utilisation_p90: range.p90 } : {}),
        pipeline_hours_week: r.pipelineHours,
        ongoing_hours_week: r.ongoingHours,
        capacity_hours_week: p.capacity,
      },
      stepId: heaviest(mine),
      roleId: main,
      personId: named ? pid : null,
      fix: main ? hire(main) : null,
    });
  }

  // --- Overtime worked to keep up with client work (docs/PRD.md §4.1, decision D7).
  for (const issue of overtimeIssues(model, result)) out.push({ detector: "overtime", ...issue });

  // --- Per step: queue growth, queue wait, single point of failure, rework, SLA.
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

    const growing = (s.role || s.person) && st.queueGrowth >= t.queueGrowthPerWeek;
    if (growing) {
      out.push({
        detector: "queue",
        key: `queue:step:${s.id}`,
        type: "bottleneck",
        severity: "critical",
        title: `The queue at ${s.name} keeps growing`,
        evidence:
          `Simulated: the queue grows by ${num(st.queueGrowth)} items a week and ends the run at ${num(st.wip)} ` +
          `(average ${num(st.avgQueue)}, average wait ${days(st.avgWait, hoursPerDay)}). ` +
          `More work arrives than ${rid ? roleName(rid) : "its people"} can clear, so it won't settle.`,
        metrics: { queue_growth_week: st.queueGrowth, queue_end: st.wip, avg_queue: st.avgQueue, avg_wait_hours: st.avgWait },
        ...base,
        fix: capacityFix(),
      });
    } else if ((s.role || s.person) && st.avgWait > t.waitHours) {
      // A growing queue's wait is unbounded; that issue covers it.
      const ratio = st.avgWait / t.waitHours;
      out.push({
        detector: "wait",
        key: `wait:step:${s.id}`,
        type: "delay",
        severity: ratio >= 2.5 ? "critical" : ratio >= 1.5 ? "serious" : "warning",
        title: `Work waits ${days(st.avgWait, hoursPerDay)} for ${s.name}`,
        evidence:
          `Simulated: items queue ${num(st.avgWait)} h on average before anyone starts them ` +
          `(threshold ${num(t.waitHours)} h); average queue ${num(st.avgQueue)}, peak ${num(st.maxQueue)}.`,
        metrics: { avg_wait_hours: st.avgWait, avg_queue: st.avgQueue, max_queue: st.maxQueue, threshold_hours: t.waitHours },
        ...base,
        fix: capacityFix(),
      });
    }

    if ((s.role || s.person) && st.arrivals > 0) {
      const who = Object.keys(people).filter((pid) => people[pid]!.capacity > 0 && eligible(pid, people[pid]!, s));
      if (who.length === 1) {
        const pid = who[0]!;
        const util = result.people[pid]?.util ?? 0;
        out.push({
          detector: "spof",
          key: `spof:step:${s.id}`,
          type: "spof",
          severity: util > t.utilisation ? "serious" : "warning",
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

    if (s.rework >= t.reworkRate && s.rework > 0) {
      const observed = st.arrivals > 0 ? st.reworks / st.arrivals : 0;
      out.push({
        detector: "rework",
        key: `rework:step:${s.id}`,
        type: "failure",
        severity: s.rework >= 2 * t.reworkRate ? "serious" : "warning",
        title: `${pct(s.rework)} of ${s.name} is done twice`,
        evidence:
          `Model: ${pct(s.rework)} of items repeat ${s.name} (threshold ${pct(t.reworkRate)}). ` +
          `Simulated: ${num(st.reworks)} repeats over the ${num(model.horizonWeeks, 0)}-week run, ${pct(observed)} of visits.`,
        metrics: { rework_rate: s.rework, reworks: st.reworks, observed_share: observed, threshold: t.reworkRate },
        ...base,
        fix: { name: `Halve rework at ${s.name}`, patch: [{ path: `steps.${s.id}.rework_rate`, op: "multiply", value: 0.5 }] },
      });
    }

    if (s.sla !== undefined && st.departures > 0) {
      const share = st.slaBreaches / st.departures;
      if (share > t.slaBreachShare) {
        // Most of the time spent queueing: more hands help. Most of it an external wait: shorten that.
        const queueing = st.avgWait >= s.wait;
        out.push({
          detector: "sla",
          key: `sla:step:${s.id}`,
          type: "sla",
          severity: share >= 0.5 ? "critical" : share >= 0.25 ? "serious" : "warning",
          title: `${s.name} misses its ${num(s.sla)} h SLA ${pct(share)} of the time`,
          evidence:
            `Simulated: ${num(st.slaBreaches)} of ${num(st.departures)} visits over the ${num(model.horizonWeeks, 0)}-week run took longer than ${num(s.sla)} h ` +
            `(queue ${num(st.avgWait)} h + hands-on ${num(s.work)} h + wait ${num(s.wait)} h on average).`,
          metrics: { breach_share: share, breaches: st.slaBreaches, departures: st.departures, sla_hours: s.sla, avg_wait_hours: st.avgWait },
          ...base,
          fix:
            queueing || !(s.wait > 0)
              ? capacityFix()
              : { name: `Halve the wait at ${s.name}`, patch: [{ path: `steps.${s.id}.wait_hours`, op: "multiply", value: 0.5 }] },
        });
      }
    }
  }

  const rank = (i: { severity: IssueSeverity; detector: Detector; key: string }) =>
    [ISSUE_SEVERITIES.indexOf(i.severity), DETECTORS.indexOf(i.detector)] as const;
  return out
    .sort((a, b) => {
      const [sa, da] = rank(a);
      const [sb, db] = rank(b);
      return sa - sb || da - db || cmp(a.key, b.key);
    })
    .map(({ detector: _detector, ...issue }) => issue);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
