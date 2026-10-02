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
export type GoalUnit = "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "percent" | "money" | "none";
export type GoalPeriod = "day" | "week" | "month" | "quarter" | "year";

export interface ParsedGoal {
  direction: Direction;
  value: number;
  unit: GoalUnit;
  /** "6 a quarter": the goal is per period. A count or money amount per period can't be checked against a whole run. */
  period: GoalPeriod | null;
}

const AT_MOST = "(?:under|below|less than|fewer than|within|at most|up to|max(?:imum)?|lower than|shorter than|no longer than)";
const AT_LEAST = "(?:over|above|more than|at least|minimum|exceeding|exceeds|greater than|higher than|longer than)";

/**
 * "under 4 hours", "below 80%", "no less than 10 wins", "10 min or less", "from 1.4 d to under 4 hours" read as a direction, a number
 * and a unit; null when they can't be. Negated phrases are read first ("no less than" is at least, not at most), the number is the one
 * after the direction word (after "to" in a "from ... to ..." goal), and a trailing "or less" or "or more" gives the direction of the
 * number before it.
 */
export function parseGoal(text: string | null | undefined): ParsedGoal | null {
  if (!text) return null;
  let t = text.toLowerCase().replace(/,/g, "").trim();
  // "from 1.4 d to under 4 hours": the goal is what follows the last "to".
  if (/\bfrom\b/.test(t) && /\bto\b/.test(t)) t = t.slice(t.lastIndexOf(" to ") + 4);

  let direction = null as Direction | null;
  let from = 0;
  let trailing = false;
  const find = (re: RegExp, d: Direction) => {
    const m = re.exec(t);
    if (m && direction === null) {
      direction = d;
      from = m.index + m[0].length;
    }
  };
  // Negated phrases first.
  find(/\b(?:no|not)\s+(?:less|fewer|lower|shorter)\s+than\b/, "atLeast");
  find(/\b(?:no|not)\s+(?:more|greater|higher|longer)\s+than\b/, "atMost");
  find(/\bnot\s+(?:under|below)\b/, "atLeast");
  find(/\bnot\s+(?:over|above)\b/, "atMost");
  // A trailing "or less" / "or more" belongs to the number before it.
  if (direction === null) {
    const m = /\bor\s+(less|fewer|under|below|lower|shorter|more|over|above|greater|higher|longer)\b/.exec(t);
    if (m) {
      direction = /^(less|fewer|under|below|lower|shorter)$/.test(m[1]!) ? "atMost" : "atLeast";
      trailing = true;
    }
  }
  if (direction === null) find(new RegExp(`(?:^|\\b)${AT_MOST}\\b|^(?:<=?|≤)`), "atMost");
  if (direction === null) find(new RegExp(`(?:^|\\b)${AT_LEAST}\\b|^(?:>=?|≥)`), "atLeast");
  if (direction === null) return null;
  // The leading symbol forms ("<4h") have no \b before them; skip over the symbol.
  const dir: Direction = direction;

  const money = /[£$€]|\b(?:usd|gbp|eur|aud)\b/.test(t);
  const n = /(\d+(?:\.\d+)?)(k|m|bn)?(?![a-z])/.exec(trailing ? t : t.slice(from));
  if (!n) return null;
  // k always means thousand; m and bn mean million and billion only beside a currency (otherwise "10m" could be minutes).
  const mult = n[2] === "k" ? 1000 : n[2] === "m" && money ? 1e6 : n[2] === "bn" && money ? 1e9 : null;
  const value = Number(n[1]) * (mult ?? 1);
  const rest = (trailing ? t : t.slice(from)).slice(n.index + n[0].length - (n[2] && mult === null ? n[2].length : 0));
  let unit: GoalUnit = "none";
  if (/^\s*(%|percent|per cent)/.test(rest)) unit = "percent";
  else if (/^\s*(seconds?|secs?|s)\b/.test(rest)) unit = "seconds";
  else if (/^\s*(minutes?|mins?|m)\b/.test(rest)) unit = "minutes";
  else if (/^\s*(hours?|hrs?|h)\b/.test(rest)) unit = "hours";
  else if (/^\s*(?:(?:business|working)\s+)?(days?|d)\b/.test(rest)) unit = "days";
  else if (/^\s*(?:(?:business|working)\s+)?(weeks?|wks?|w)\b/.test(rest)) unit = "weeks";
  else if (/^\s*(months?|mos?)\b/.test(rest)) unit = "months";
  else if (money) unit = "money";
  const per = /(?:\bper\b|\ba\b|\beach\b|\bevery\b|\/)\s*(day|week|month|quarter|year)\b/.exec(t);
  return { direction: dir, value, unit, period: (per?.[1] as GoalPeriod | undefined) ?? null };
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

const TIME_UNITS: readonly GoalUnit[] = ["seconds", "minutes", "hours", "days", "weeks", "months"];
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

/** A time in the unit the goal was written in, so "under 3 hours" is answered in hours and "under 2 days" in days. */
export function formatSpanLike(hours: number, hoursPerWeek: number, unit: GoalUnit): string {
  if (unit === "seconds") return `${formatNumber(hours * 3600, 0)} s`;
  if (unit === "minutes") return `${formatNumber(hours * 60, 0)} min`;
  if (unit === "months") return `${formatNumber(hours / ((hoursPerWeek * 52) / 12), 1)} mo`;
  if (unit === "days") return `${formatNumber(hours / (hoursPerWeek / 5), 1)} d`;
  if (unit === "weeks") return `${formatNumber(hours / hoursPerWeek, 1)} w`;
  if (unit === "hours") return `${formatNumber(hours, hours < 10 ? 1 : 0)} h`;
  return formatSpan(hours, hoursPerWeek);
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

  // A goal per period ("6 a quarter") isn't a total for the run, and the run's length isn't the period: no verdict for counts and money.
  if (goal.period && ["won", "wip", "mrr", "revenue", "labour"].includes(kind)) {
    return unchecked(`The goal “${goalText(target.goal)}” is per ${goal.period}, and the simulation reports totals for the whole run, so it wasn't checked. Give your own verdict.`);
  }
  // Put the goal in the measure's own unit.
  const hpw = model.hoursPerWeek;
  let goalValue: number;
  if (TIME.includes(kind)) {
    // Working hours: a working day is a fifth of the week, a month a twelfth of the year's weeks. No unit, or a unit that isn't time: no verdict.
    const toHours = { seconds: 1 / 3600, minutes: 1 / 60, hours: 1, days: hpw / 5, weeks: hpw, months: (hpw * 52) / 12, none: NaN, percent: NaN, money: NaN } as const;
    goalValue = goal.value * toHours[goal.unit];
  } else if (kind === "busy" || kind === "winRate") {
    if (goal.unit !== "percent" && goal.unit !== "none") return unchecked(`The goal “${goalText(target.goal)}” isn't a percentage, so it wasn't checked. Give your own verdict.`);
    goalValue = goal.value / 100;
  } else if (kind === "mrr" || kind === "revenue" || kind === "labour") {
    if (goal.unit === "percent" || TIME_UNITS.includes(goal.unit)) return unchecked(`The goal “${goalText(target.goal)}” isn't an amount of money, so it wasn't checked. Give your own verdict.`);
    goalValue = goal.value;
  } else {
    if (goal.unit === "percent" || goal.unit === "money" || TIME_UNITS.includes(goal.unit)) return unchecked(`The goal “${goalText(target.goal)}” isn't a count, so it wasn't checked. Give your own verdict.`);
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
  const shown = TIME.includes(kind) ? formatSpanLike(mean, hpw, goal.unit) : kind === "busy" || kind === "winRate" ? `${Math.round(mean * 100)}%` : formatNumber(mean, mean < 10 ? 1 : 0);
  return {
    status: meets(mean) ? "pass" : "fail",
    holdsPct,
    value: mean,
    note: `${(target.measure ?? "").trim() || label}: ${shown} on average, against ${goalText(target.goal)}. It meets the goal in ${holdsPct}% of runs.`,
  };
}
