// The automatic verdict (issue #114, A49): did the simulated solution meet the issue's target?
//
// An issue's target is three bits of free text: what is measured ("Wait at Check fit"), its value now ("1.4 d") and the
// goal ("under 4 hours"). The verdict reads the goal as a direction, a number and a unit, picks the number the
// simulation computes that the measure names, and checks it in each of the simulation's runs. "Holds" is the share of
// runs that meet the goal; the verdict is a pass when the average run does, and a fail otherwise. A target that can't be
// read, or names something the simulation doesn't compute, gets no verdict, and says why: the person's own verdict is the
// final call either way.
//
// Everything here is deterministic. A step's wait and a role's busy-ness are not kept per run by the engine, so those are
// read by re-running each run on its own with the seed the full run gave it (`seed + i * SEED_STRIDE`), which reproduces
// the same run. Pure and framework-free, so the Editor's footer, the Save button and the tests all read one answer.

import { SEED_STRIDE, simulate, type EngineModel, type SimulationResult } from "@transpera-flow/engine";
import { formatNumber } from "@/lib/format";

export type Direction = "atMost" | "atLeast";
export type GoalUnit = "hours" | "minutes" | "days" | "weeks" | "percent" | "money" | "none";

export interface ParsedGoal {
  direction: Direction;
  value: number;
  unit: GoalUnit;
}

/** "under 4 hours", "below 80%", "at least 6 a quarter" read as a direction, a number and a unit; null when they can't be. */
export function parseGoal(text: string | null | undefined): ParsedGoal | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, "").trim();
  let direction: Direction | null = null;
  if (/^(<=?|≤)|\b(under|below|less than|fewer than|within|at most|no more than|max(?:imum)?|up to|no longer than|lower than)\b/.test(t)) direction = "atMost";
  else if (/^(>=?|≥)|\b(over|above|more than|at least|min(?:imum)?|exceeding|exceeds|greater than|higher than)\b/.test(t)) direction = "atLeast";
  if (!direction) return null;
  const n = /(\d+(?:\.\d+)?)\s*(k\b)?/.exec(t);
  if (!n) return null;
  const value = Number(n[1]) * (n[2] ? 1000 : 1);
  const after = t.slice(n.index + n[0].length);
  let unit: GoalUnit = "none";
  if (/^\s*(%|percent|per cent)/.test(after)) unit = "percent";
  else if (/^\s*(minutes?|mins?)\b/.test(after)) unit = "minutes";
  else if (/^\s*(hours?|hrs?|h)\b/.test(after)) unit = "hours";
  else if (/^\s*(working days?|days?|d)\b/.test(after)) unit = "days";
  else if (/^\s*(weeks?|wks?|w)\b/.test(after)) unit = "weeks";
  else if (/[£$€]/.test(t)) unit = "money";
  return { direction, value, unit };
}

export type MeasureKind = "handsOn" | "wait" | "busy" | "cycle" | "areaTime" | "winRate" | "won" | "mrr" | "revenue" | "labour" | "wip";

/** What the measure's words name, in the order they are tried; null when the simulation computes nothing like it. */
export function measureKind(measure: string | null | undefined, hasArea: boolean): MeasureKind | null {
  const m = (measure ?? "").toLowerCase();
  if (!m.trim()) return null;
  if (/hands.?on|touch time|effort|work per|time spent working/.test(m)) return hasArea ? "handsOn" : null;
  if (/\bwip\b|backlog|work in progress|waiting items|items waiting|queue length/.test(m)) return "wip";
  if (/\bwait|queue|delay/.test(m)) return hasArea ? "wait" : null;
  if (/busy|utili[sz]ation|capacity|workload|\bload\b/.test(m)) return "busy";
  if (/win rate|conversion|close rate/.test(m)) return "winRate";
  if (/cycle|end.to.end|lead time|time to (close|win|complete|deliver|finish)|turnaround/.test(m)) return hasArea && /turnaround/.test(m) ? "areaTime" : "cycle";
  if (/\btime\b|duration|how long/.test(m)) return hasArea ? "areaTime" : "cycle";
  if (/\bmrr\b|recurring/.test(m)) return "mrr";
  if (/revenue|billed|billing/.test(m)) return "revenue";
  if (/labou?r|cost/.test(m)) return "labour";
  if (/\bwins?\b|\bwon\b|clients? won|deals? won/.test(m)) return "won";
  return null;
}

const TIME: readonly MeasureKind[] = ["handsOn", "wait", "cycle", "areaTime"];

export interface TargetVerdict {
  /** `unchecked`: no verdict (see `note`); the person's own verdict decides. */
  status: "pass" | "fail" | "unchecked";
  /** The share of simulated runs that meet the goal, 0 to 100; null when unchecked. */
  holdsPct: number | null;
  /** What it was checked against, or why it wasn't, in plain English. */
  note: string;
  /** The average run's value, in the measure's own unit (hours, a share, a count or money); null when unchecked. */
  value: number | null;
}

const unchecked = (note: string): TargetVerdict => ({ status: "unchecked", holdsPct: null, note, value: null });

/** A time in working hours, as a person reads it: hours under a working day, else days. */
export function formatSpan(hours: number, hoursPerWeek: number): string {
  const day = hoursPerWeek / 5;
  return hours < day ? `${formatNumber(hours, hours < 10 ? 1 : 0)} h` : `${formatNumber(hours / day, hours / day < 10 ? 1 : 0)} d`;
}

/** The goal as the person wrote it, for the note. */
const goalText = (goal: string | null | undefined) => (goal ?? "").trim();

/** Each simulated run on its own, with the seed the full run gave it. Those runs are the same runs the full result averaged. */
function eachRun(model: EngineModel, result: SimulationResult): SimulationResult[] {
  return Array.from({ length: result.reps }, (_, i) => simulate(model, 1, result.seed + i * SEED_STRIDE));
}

/**
 * Checks a simulated process against an issue's target.
 *
 * @param area the step ids the issue touches, groups already opened out to the steps inside them (`leafIds`); the target's
 *   wait, hands-on time and time are read over these.
 */
export function checkTarget(args: {
  target: { measure: string | null; goal: string | null };
  model: EngineModel;
  result: SimulationResult;
  area: readonly string[];
}): TargetVerdict {
  const { target, model, result } = args;
  const goal = parseGoal(target.goal);
  if (!goal) {
    return unchecked(target.goal?.trim() ? `Couldn't read the goal “${goalText(target.goal)}” as a number to check. Give your own verdict.` : "This issue has no goal to check against. Give your own verdict.");
  }
  const area = args.area.filter((id) => id in result.steps);
  const kind = measureKind(target.measure, area.length > 0);
  if (!kind) {
    return unchecked(`The simulation doesn't compute “${(target.measure ?? "").trim() || "this measure"}”, so it wasn't checked. Give your own verdict.`);
  }

  // Put the goal in the measure's own unit.
  const hpw = model.hoursPerWeek;
  let goalValue: number;
  if (TIME.includes(kind)) {
    const toHours = { hours: 1, minutes: 1 / 60, days: hpw / 5, weeks: hpw, none: 1, percent: NaN, money: NaN } as const;
    goalValue = goal.value * toHours[goal.unit];
  } else if (kind === "busy" || kind === "winRate") {
    if (goal.unit !== "percent" && goal.unit !== "none") return unchecked(`The goal “${goalText(target.goal)}” isn't a percentage, so it wasn't checked. Give your own verdict.`);
    goalValue = goal.value / 100;
  } else if (kind === "mrr" || kind === "revenue" || kind === "labour") {
    if (goal.unit === "percent" || ["hours", "days", "weeks", "minutes"].includes(goal.unit)) return unchecked(`The goal “${goalText(target.goal)}” isn't an amount of money, so it wasn't checked. Give your own verdict.`);
    goalValue = goal.value;
  } else {
    if (goal.unit === "percent" || goal.unit === "money" || ["hours", "days", "weeks", "minutes"].includes(goal.unit)) return unchecked(`The goal “${goalText(target.goal)}” isn't a count, so it wasn't checked. Give your own verdict.`);
    goalValue = goal.value;
  }
  if (!Number.isFinite(goalValue)) return unchecked(`The goal “${goalText(target.goal)}” doesn't match what “${(target.measure ?? "").trim()}” measures, so it wasn't checked. Give your own verdict.`);

  const s = result.samples;
  const staticHours = (field: "work" | "wait") => model.steps.filter((st) => area.includes(st.id)).reduce((a, st) => a + (st[field] ?? 0), 0);
  let values: number[];
  let label: string;
  switch (kind) {
    case "handsOn":
      values = [staticHours("work")];
      label = "hands-on time";
      break;
    case "wait": {
      values = eachRun(model, result).map((r) => area.reduce((a, id) => a + (r.steps[id]?.avgWait ?? 0), 0));
      label = "wait";
      break;
    }
    case "areaTime": {
      const fixed = staticHours("work") + staticHours("wait");
      values = eachRun(model, result).map((r) => fixed + area.reduce((a, id) => a + (r.steps[id]?.avgWait ?? 0), 0));
      label = "time through these steps";
      break;
    }
    case "busy": {
      const roles = new Set(area.map((id) => model.steps.find((st) => st.id === id)?.role).filter((r): r is string => !!r && r in result.roles));
      if (!roles.size && result.bnRole) roles.add(result.bnRole);
      values = eachRun(model, result).map((r) => Math.max(0, ...[...roles].map((role) => r.roles[role]?.util ?? 0)));
      label = "busiest role";
      break;
    }
    case "cycle":
      values = s.cycleMean.filter((c) => c > 0);
      label = "time to complete";
      break;
    case "winRate":
      values = s.won.flatMap((w, i) => (w + s.lost[i]! > 0 ? [w / (w + s.lost[i]!)] : []));
      label = "win rate";
      break;
    case "won":
      values = s.won;
      label = "wins";
      break;
    case "mrr":
      values = s.mrrAdded;
      label = "new monthly revenue";
      break;
    case "revenue":
      values = s.billed;
      label = "revenue billed";
      break;
    case "labour":
      values = s.labour;
      label = "labour cost";
      break;
    case "wip":
      values = s.wipEnd;
      label = "work in progress";
      break;
  }
  if (!values.length) return unchecked(`The simulation had no value for “${(target.measure ?? "").trim()}”, so it wasn't checked. Give your own verdict.`);

  const meets = (v: number) => (goal.direction === "atMost" ? v <= goalValue + 1e-9 : v >= goalValue - 1e-9);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const holdsPct = Math.round((100 * values.filter(meets).length) / values.length);
  const shown = TIME.includes(kind) ? formatSpan(mean, hpw) : kind === "busy" || kind === "winRate" ? `${Math.round(mean * 100)}%` : formatNumber(mean, mean < 10 ? 1 : 0);
  return {
    status: meets(mean) ? "pass" : "fail",
    holdsPct,
    value: mean,
    note: `${(target.measure ?? "").trim() || label}: ${shown} on average, against ${goalText(target.goal)}. It meets the goal in ${holdsPct}% of runs.`,
  };
}
