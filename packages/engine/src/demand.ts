// Arrival times (docs/PRD.md §6.3.2): a Poisson process whose rate is
// `leadsPerWeek`, optionally modulated by the calendar month (seasonality) and
// compounded monthly growth. The rate is piecewise constant, one piece per
// calendar month, so the arrivals are drawn by time change: unit-rate
// exponential gaps are spent against each month's rate in turn. That costs
// one draw per arrival plus one step per month crossed, and a month's
// multiplier changes how far each draw reaches, not the draws themselves, so
// a seasonal scenario and a flat baseline share their random numbers.

import type { EngineDemand, EngineModel } from "./model";
import { expo, type Rng } from "./random";

/** Weeks in a calendar month: twelve months make a 52-week year. */
export const WEEKS_PER_CALENDAR_MONTH = 52 / 12;

const MONTHS = 12;

/** A model's demand, checked, or null when the rate is constant. */
interface Calendar {
  /** Arrivals per hour before seasonality and growth. */
  base: number;
  monthHours: number;
  startMonth: number;
  /** The whole month t = 0 falls in (growth counts from it). */
  firstMonth: number;
  seasonality: number[];
  growth: number;
}

/** x^n for a whole n by repeated squaring (plain multiplication, so identical in every JS engine). */
function powInt(x: number, n: number): number {
  let result = 1;
  for (let b = x, k = Math.abs(n); k > 0; k >>= 1, b *= b) if (k & 1) result *= b;
  return n < 0 ? 1 / result : result;
}

/** Throws on demand settings the engine can't run; see `EngineDemand`. */
export function checkDemand(demand: EngineDemand | undefined): void {
  if (!demand) return;
  const { seasonality, growthMonthly, startMonth } = demand;
  if (seasonality !== undefined) {
    if (seasonality.length !== MONTHS) throw new Error("Seasonality needs 12 monthly multipliers");
    if (!seasonality.every((m) => Number.isFinite(m) && m >= 0)) {
      throw new Error("Seasonality multipliers must be 0 or more");
    }
  }
  if (growthMonthly !== undefined && !(Number.isFinite(growthMonthly) && growthMonthly > -1)) {
    throw new Error("Monthly growth must be more than -100%");
  }
  if (startMonth !== undefined && !Number.isFinite(startMonth)) throw new Error("The start month must be a number");
}

/** True when the demand settings change nothing: every multiplier 1 and no growth. */
export function isFlatDemand(demand: EngineDemand | undefined): boolean {
  return !demand || ((demand.seasonality ?? []).every((m) => m === 1) && !demand.growthMonthly);
}

function calendar(model: EngineModel): Calendar | null {
  const { demand } = model;
  checkDemand(demand);
  if (isFlatDemand(demand)) return null;
  const startMonth = demand!.startMonth ?? 0;
  return {
    base: model.leadsPerWeek / model.hoursPerWeek,
    monthHours: WEEKS_PER_CALENDAR_MONTH * model.hoursPerWeek,
    startMonth,
    firstMonth: Math.floor(startMonth),
    seasonality: demand!.seasonality ?? new Array<number>(MONTHS).fill(1),
    growth: demand!.growthMonthly ?? 0,
  };
}

/**
 * Multiplier on the base rate in whole calendar month `j`, counted from
 * January of the year the run starts in (negative before it).
 */
function monthFactor(c: Calendar, j: number): number {
  const season = c.seasonality[((j % MONTHS) + MONTHS) % MONTHS]!;
  return season * (c.growth ? powInt(1 + c.growth, j - c.firstMonth) : 1);
}

/**
 * Multiplier on `leadsPerWeek` at simulation hour `t`: seasonality for the
 * calendar month `t` falls in, times growth since the start month. 1 when the
 * model has no demand settings.
 */
export function demandFactor(model: EngineModel, t: number): number {
  const c = calendar(model);
  return c ? monthFactor(c, Math.floor(c.startMonth + t / c.monthHours)) : 1;
}

/**
 * Arrival times in [-W, H), ascending. Those in [0, H) come from the
 * `arrivals` stream, forwards from 0; the warm-up's from `early`, backwards
 * from 0, so the measured window's arrivals are the same whatever the
 * warm-up length.
 */
export function arrivalTimes(model: EngineModel, H: number, W: number, arrivals: Rng, early: Rng): number[] {
  const c = calendar(model);
  const times: number[] = [];
  if (!c) {
    // Constant rate: exactly the draws and sums the engine has always made.
    const meanGap = model.hoursPerWeek / model.leadsPerWeek;
    if (W > 0) {
      for (let tb = -expo(early, meanGap); tb >= -W; tb -= expo(early, meanGap)) times.push(tb);
      times.reverse();
    }
    for (let ta = expo(arrivals, meanGap); ta < H; ta += expo(arrivals, meanGap)) times.push(ta);
    return times;
  }
  if (W > 0) {
    times.push(...walk(c, W, -1, early).map((t) => -t));
    times.reverse();
  }
  times.push(...walk(c, H, 1, arrivals));
  return times;
}

/**
 * Arrival distances from t = 0 going forwards (dir 1) or backwards (dir -1),
 * up to `limit` hours: each unit-rate exponential draw is spent against the
 * months' rates until it runs out, which places the next arrival.
 */
function walk(c: Calendar, limit: number, dir: 1 | -1, rng: Rng): number[] {
  const out: number[] = [];
  // Position along the calendar in months, and the whole month it is in.
  const pos = c.startMonth;
  let j = c.firstMonth;
  let t = 0;
  // Distance from t = 0 to the edge of month j in the walking direction.
  const edge = (m: number) => dir * ((dir > 0 ? m + 1 : m) - pos) * c.monthHours;
  let need = expo(rng, 1);
  while (t < limit) {
    const rate = c.base * monthFactor(c, j);
    const end = Math.min(limit, edge(j));
    const room = (end - t) * rate;
    if (rate > 0 && need < room) {
      t += need / rate;
      if (t >= limit) break;
      out.push(t);
      need = expo(rng, 1);
    } else {
      need -= room;
      t = end;
      j += dir;
    }
  }
  return out;
}
