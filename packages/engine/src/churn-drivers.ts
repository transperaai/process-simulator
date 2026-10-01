// Churn drivers (docs/PRD.md decisions D21 and D28; ticket A56, issue #121).
//
// A client's base churn (its service's "normal churn", from the client group)
// is multiplied by what is going on around it. Each reason clients leave is a
// driver with a weight (0 to 3; 1 is normal, 0 ignores it) and an on/off
// switch. A driver has a pressure for each client in each week: how much extra
// churn the cause adds at weight 1, where 0 means nothing is wrong and 1
// doubles that client's churn. The weekly churn chance of a client is
//
//   base × (1 + Σ weight × pressure) × market
//
// where the sum runs over the switched-on drivers other than the market, and
// the market driver stretches the whole thing by the month's "clients
// leaving" factor (market.ts), weighted: 1 + weight × (factor − 1).
//
// The engine measures what it can:
//   late      the health a client has lost to late or missed servicing work
//             (the health-sensitivity term of docs/PRD.md §6.3.5, as before);
//   resp      the share of its ad-hoc requests answered late or not at all;
//   onb       how long a client signed in the run waited for its first delivery;
//   rework    the share of its servicing visits that had to be done again;
//   load      how busy the people who look after it are, above 85%;
//   handoff   an entered rate of account manager changes, plus time its
//             people are away (the measured part);
//   market    the market's "clients leaving" factor.
// The rest take what you enter as a stated assumption: results (a score out
// of 10), tenure (the multiple in the first six months), price (a planned
// rise) and any driver of your own (the extra churn it causes, in percent).
//
// With the defaults (late and market on at weight 1, everything else off) the
// formula is exactly the one the engine used before drivers existed, so a
// model with no `churnDrivers` runs and rounds exactly as it did. Pure: no I/O.

import { clientChurnMonthly, withClientGroups } from "./clients";
import type { EngineModel } from "./model";

export const BUILTIN_CHURN_DRIVER_IDS = ["late", "resp", "onb", "rework", "load", "handoff", "results", "tenure", "price", "market"] as const;
export type BuiltinChurnDriverId = (typeof BUILTIN_CHURN_DRIVER_IDS)[number];

/** Custom drivers' ids start with this. */
export const CUSTOM_DRIVER_PREFIX = "custom:";

/** Where a driver's number comes from, as the screen words it. */
export type ChurnDriverSource = "measured" | "partly" | "entered" | "lever" | "market";

export const CHURN_SOURCE_LABELS: Record<ChurnDriverSource, string> = {
  measured: "Measured",
  partly: "Partly measured",
  entered: "You enter it",
  lever: "Lever",
  market: "From market settings",
};

/** The limits of a weight: 0 ignores the cause, 1 is normal, 3 matters three times as much. */
export const CHURN_WEIGHT_MIN = 0;
export const CHURN_WEIGHT_MAX = 3;

export interface ChurnDriverSpec {
  id: BuiltinChurnDriverId;
  name: string;
  source: ChurnDriverSource;
  /** Switched on until you say otherwise: only the two the engine always applied. */
  defaultEnabled: boolean;
  /** The value you enter (stated assumption), or the target it is measured against; null when the driver has none. */
  defaultValue: number | null;
  /** Limits of the entered value. */
  valueRange: { min: number; max: number } | null;
  /** What the entered value is, in a few words. */
  valueLabel: string | null;
}

export const CHURN_DRIVER_SPECS: Record<BuiltinChurnDriverId, ChurnDriverSpec> = {
  late: { id: "late", name: "Late or missed servicing work", source: "measured", defaultEnabled: true, defaultValue: null, valueRange: null, valueLabel: null },
  resp: { id: "resp", name: "Response time to ad-hoc requests", source: "measured", defaultEnabled: false, defaultValue: null, valueRange: null, valueLabel: null },
  onb: {
    id: "onb",
    name: "Onboarding speed (won to first delivery)",
    source: "measured",
    defaultEnabled: false,
    defaultValue: 10,
    valueRange: { min: 1, max: 120 },
    valueLabel: "Normal first delivery, in working days",
  },
  rework: { id: "rework", name: "Rework or errors on deliverables", source: "measured", defaultEnabled: false, defaultValue: null, valueRange: null, valueLabel: null },
  load: { id: "load", name: "Account team overload (above 85% busy)", source: "measured", defaultEnabled: false, defaultValue: null, valueRange: null, valueLabel: null },
  handoff: {
    id: "handoff",
    name: "Account manager changes",
    source: "partly",
    defaultEnabled: false,
    defaultValue: 0.3,
    valueRange: { min: 0, max: 1 },
    valueLabel: "Share of clients whose account manager changes in a year",
  },
  results: {
    id: "results",
    name: "Client results or satisfaction",
    source: "entered",
    defaultEnabled: false,
    defaultValue: 7,
    valueRange: { min: 0, max: 10 },
    valueLabel: "Average rating out of 10",
  },
  tenure: {
    id: "tenure",
    name: "Early tenure (first 6 months)",
    source: "entered",
    defaultEnabled: false,
    defaultValue: 1.6,
    valueRange: { min: 1, max: 5 },
    valueLabel: "Times as likely to leave in months 1 to 6",
  },
  price: {
    id: "price",
    name: "Price changes",
    source: "lever",
    defaultEnabled: false,
    defaultValue: 0,
    valueRange: { min: 0, max: 100 },
    valueLabel: "Planned price rise, %",
  },
  market: { id: "market", name: "Market conditions", source: "market", defaultEnabled: true, defaultValue: null, valueRange: null, valueLabel: null },
};

/** The limits of a custom driver's value: the extra churn it causes at weight 1, in percent. */
export const CUSTOM_DRIVER_VALUE = { min: 0, max: 500, default: 20 } as const;

/** What a stored driver looks like to the engine: a builtin's id or `custom:<id>`, and what you set. */
export interface EngineChurnDriver {
  id: string;
  /** 0 to 3. */
  weight: number;
  enabled: boolean;
  /** The entered value (see `ChurnDriverSpec.valueLabel`); a custom driver's is its extra churn in percent. */
  value?: number | null;
  /** Price changes only: the month (1 to 24 of the run) the rise takes effect; it weighs on churn for three months. */
  month?: number | null;
  /** A custom driver's name. */
  name?: string;
}

/** A driver as the engine resolves it. */
export interface ResolvedChurnDriver {
  id: string;
  name: string;
  source: ChurnDriverSource;
  custom: boolean;
  weight: number;
  enabled: boolean;
  /** The entered value, or null when the driver takes none. */
  value: number | null;
  /** Price changes: the month the rise takes effect (1-based). */
  month: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The drivers a model runs with: the ten built-ins in the screen's order (each
 * as set, or at its default), then the custom ones in the order given.
 * Out-of-range weights and values are brought into range, unknown ids that
 * aren't custom are ignored, and a repeated id keeps its first entry.
 */
export function resolveChurnDrivers(model: Pick<EngineModel, "churnDrivers">): ResolvedChurnDriver[] {
  // A run asks once per replication: the answer for a model is the same, so it is kept (and must not be changed by callers).
  const kept = resolved.get(model);
  if (kept) return kept;
  const out = resolveUncached(model);
  resolved.set(model, out);
  return out;
}

const resolved = new WeakMap<object, ResolvedChurnDriver[]>();

function resolveUncached(model: Pick<EngineModel, "churnDrivers">): ResolvedChurnDriver[] {
  const given = new Map<string, EngineChurnDriver>();
  for (const d of model.churnDrivers ?? []) if (!given.has(d.id)) given.set(d.id, d);
  const out: ResolvedChurnDriver[] = [];
  for (const id of BUILTIN_CHURN_DRIVER_IDS) {
    const spec = CHURN_DRIVER_SPECS[id];
    const d = given.get(id);
    const range = spec.valueRange;
    out.push({
      id,
      name: spec.name,
      source: spec.source,
      custom: false,
      weight: d && finite(d.weight) ? clamp(d.weight, CHURN_WEIGHT_MIN, CHURN_WEIGHT_MAX) : 1,
      enabled: d ? d.enabled !== false : spec.defaultEnabled,
      value: range ? (d && finite(d.value) ? clamp(d.value, range.min, range.max) : spec.defaultValue) : null,
      month: id === "price" && d && finite(d.month) ? clamp(Math.round(d.month), 1, 24) : 1,
    });
  }
  for (const [id, d] of given) {
    if (!id.startsWith(CUSTOM_DRIVER_PREFIX)) continue;
    out.push({
      id,
      name: d.name?.trim() || "Your own driver",
      source: "entered",
      custom: true,
      weight: finite(d.weight) ? clamp(d.weight, CHURN_WEIGHT_MIN, CHURN_WEIGHT_MAX) : 1,
      enabled: d.enabled !== false,
      value: finite(d.value) ? clamp(d.value, CUSTOM_DRIVER_VALUE.min, CUSTOM_DRIVER_VALUE.max) : CUSTOM_DRIVER_VALUE.default,
      month: 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pressure: how much extra churn a cause adds at weight 1
// ---------------------------------------------------------------------------

/** A quarter of a client's work redone is the most rework counts for. */
export const REWORK_FULL_SHARE = 0.25;
/** Half of a client's ad-hoc requests late or missed is the most response time counts for. */
export const RESPONSE_FULL_SHARE = 0.5;
/** Busy share above which the team looking after a client is overloaded, and where the pressure is full. */
export const LOAD_THRESHOLD = 0.85;
export const LOAD_FULL = 1;
/** Weeks of a client's life that count as early tenure. */
export const EARLY_TENURE_WEEKS = 26;
/** Weeks a planned price rise weighs on churn. */
export const PRICE_WEIGHT_WEEKS = 13;
/** Pressure per whole unit of price rise: a 10% rise adds 20% to churn. */
export const PRICE_PRESSURE_PER_UNIT = 2;
/** A rating of this or more out of 10 adds nothing; each point below adds `RESULTS_PRESSURE_PER_POINT`. */
export const RESULTS_NORMAL_SCORE = 8;
export const RESULTS_PRESSURE_PER_POINT = 0.25;
/** An account manager change adds this much for a client whose people are away. */
export const AWAY_PRESSURE = 0.5;

/** Late or missed share of ad-hoc requests, 0 to 1 pressure. */
export const responsePressure = (badShare: number): number => clamp(badShare / RESPONSE_FULL_SHARE, 0, 1);
/** Share of visits done again, 0 to 1 pressure. */
export const reworkPressure = (share: number): number => clamp(share / REWORK_FULL_SHARE, 0, 1);
/** How busy a team is (1 = 100%), above the 85% line. */
export const loadPressure = (util: number): number => clamp((util - LOAD_THRESHOLD) / (LOAD_FULL - LOAD_THRESHOLD), 0, 1);
/** Waiting longer than normal for the first delivery: twice as long as normal is full pressure. */
export const onboardingPressure = (delayHours: number, normalHours: number): number =>
  normalHours > 0 && delayHours > normalHours ? Math.min(1, (delayHours - normalHours) / normalHours) : 0;
/** An average rating out of 10. */
export const resultsPressure = (score: number): number => clamp((RESULTS_NORMAL_SCORE - score) * RESULTS_PRESSURE_PER_POINT, 0, 1);
/** A price rise in percent. */
export const pricePressure = (risePercent: number): number => Math.max(0, risePercent / 100) * PRICE_PRESSURE_PER_UNIT;

// ---------------------------------------------------------------------------
// What a run reports
// ---------------------------------------------------------------------------

/** One cause of churn in a run. */
export interface ChurnCause {
  id: string;
  name: string;
  source: ChurnDriverSource;
  custom: boolean;
  enabled: boolean;
  weight: number;
  /** Share of all the churn it causes (0-1), by clients; the shares of every cause and normal churn add up to 1. */
  share: number;
  /** Clients lost to it in a run, on average. */
  clients: number;
  /** Monthly fees of the clients lost to it, in a run, on average. */
  mrr: number;
  /** Its average pressure on an active client over the run (0 = nothing wrong; the market's is its factor minus 1). */
  pressure: number;
  /**
   * What was measured or entered, in the driver's own unit: the share of work late or missed (late), hours to answer
   * an ad-hoc request (resp), working days to first delivery (onb), the share of work redone (rework), how busy the
   * busiest of the team is, 0-1 (load), the entered number (handoff, results, tenure, price, your own), or the
   * market's average "clients leaving" factor (market). Null when nothing could be measured.
   */
  value: number | null;
  /** A person's id when the value is theirs (load: the busiest). */
  valuePerson?: string;
}

/** One service's churn by cause (a service's clients, including those won in the run). */
export interface ChurnCausesByService {
  /** Clients lost in a run, on average (all causes). */
  clients: number;
  /** Share of that churn each cause is responsible for, by driver id; `normal` is the rest. */
  shares: Record<string, number>;
}

export interface ChurnCauses {
  /** Clients lost in a run, on average: what the causes below add up to. */
  clients: number;
  /** Their monthly fees. */
  mrr: number;
  /** The part of the churn that is simply base churn ("normal churn"): not blamed on any driver. */
  normal: { share: number; clients: number; mrr: number };
  /** Every driver, in the screen's order (built-ins, then your own), including those switched off. */
  causes: ChurnCause[];
  /** By service id; clients on no known service are under `""`. */
  byService: Record<string, ChurnCausesByService>;
  /** Average of the "clients leaving" market factor (1 with no market). */
  marketFactor: number;
  /** The base churn of the clients at the start, in clients a month, and their mean base rate. */
  baseClientsPerMonth: number;
}

/** One replication's raw churn accounting, indexed by slot: 0 is normal churn, then each resolved driver in order. */
export interface ChurnReplication {
  clients: number[];
  mrr: number[];
  /** Sum of every active client-week's pressure, per slot; divide by `pressureN`. */
  pressure: number[];
  pressureN: number;
  /** Per service id ("" for none): expected clients lost per slot. */
  byService: Record<string, number[]>;
  /** The measured value per driver slot (null: nothing to measure). */
  values: (number | null)[];
  valuePerson: (string | null)[];
}

/** Average the replications' accounting into the run's causes. Pure. */
export function summariseChurn(model: EngineModel, drivers: readonly ResolvedChurnDriver[], reps: readonly ChurnReplication[]): ChurnCauses {
  const n = reps.length || 1;
  const slots = drivers.length + 1;
  const mean = (f: (r: ChurnReplication, i: number) => number, i: number) => reps.reduce((a, r) => a + f(r, i), 0) / n;
  const clientsBy: number[] = [];
  const mrrBy: number[] = [];
  for (let i = 0; i < slots; i++) {
    clientsBy.push(mean((r, s) => r.clients[s]!, i));
    mrrBy.push(mean((r, s) => r.mrr[s]!, i));
  }
  const totalClients = clientsBy.reduce((a, b) => a + b, 0);
  const totalMrr = mrrBy.reduce((a, b) => a + b, 0);
  const share = (v: number) => (totalClients > 0 ? v / totalClients : 0);
  const causes: ChurnCause[] = drivers.map((d, k) => {
    const s = k + 1;
    const withPressure = reps.filter((r) => r.pressureN > 0);
    const values = reps.map((r) => r.values[s] ?? null).filter((v): v is number => v !== null);
    const of = reps.map((r) => r.valuePerson[s] ?? null).find((v) => v !== null);
    return {
      id: d.id,
      name: d.name,
      source: d.source,
      custom: d.custom,
      enabled: d.enabled,
      weight: d.weight,
      share: share(clientsBy[s]!),
      clients: clientsBy[s]!,
      mrr: mrrBy[s]!,
      pressure: withPressure.length ? withPressure.reduce((a, r) => a + r.pressure[s]! / r.pressureN, 0) / withPressure.length : 0,
      value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      ...(of ? { valuePerson: of } : {}),
    };
  });
  const byService: Record<string, ChurnCausesByService> = {};
  const services = new Set<string>();
  for (const r of reps) for (const sid of Object.keys(r.byService)) services.add(sid);
  for (const sid of [...services].sort()) {
    const per = new Array<number>(slots).fill(0);
    for (const r of reps) {
      const row = r.byService[sid];
      if (row) for (let s = 0; s < slots; s++) per[s]! += row[s]! / n;
    }
    const total = per.reduce((a, b) => a + b, 0);
    const shares: Record<string, number> = { normal: total > 0 ? per[0]! / total : 0 };
    drivers.forEach((d, k) => (shares[d.id] = total > 0 ? per[k + 1]! / total : 0));
    byService[sid] = { clients: total, shares };
  }
  const market = causes.find((c) => c.id === "market");
  return {
    clients: totalClients,
    mrr: totalMrr,
    normal: { share: share(clientsBy[0]!), clients: clientsBy[0]!, mrr: mrrBy[0]! },
    causes,
    byService,
    marketFactor: market ? 1 + market.pressure : 1,
    baseClientsPerMonth: baseClientsPerMonth(model),
  };
}

/** Clients a month the model's clients at the start lose to normal churn alone: Σ each client's base monthly churn. */
export function baseClientsPerMonth(source: EngineModel): number {
  const model = withClientGroups(source);
  if (model.clients && Object.keys(model.clients).length) {
    let sum = 0;
    for (const cid of Object.keys(model.clients).sort()) sum += clientChurnMonthly(model, model.clients[cid]!);
    return sum;
  }
  return model.activeClients * model.churnMonthly;
}

/** A weight set to try on the screen, by driver id. */
export interface DriverWeightChoice {
  id: string;
  weight: number;
  enabled: boolean;
}

/** The screen's projection: churn and each driver's share with weights as chosen, from a run's measured pressures. */
export interface ChurnProjection {
  /** Clients a month. */
  clientsPerMonth: number;
  /** Each driver's share of that churn (0-1), by id; switched off drivers have 0. */
  shares: Record<string, number>;
  /** Normal churn's share. */
  normalShare: number;
}

/**
 * Churn per month with the weights as chosen, from the pressures a run
 * measured: base × (1 + Σ weight × pressure) × (1 + market weight × (factor − 1)).
 * It moves as the weights move, with no new simulation. Each driver's pressure is
 * the run's average over all client-weeks, not weighted by each client's base churn,
 * so it can differ a little from the run's own shares when clients with high base
 * churn carry different pressure from the rest. A projection, not a
 * run: it holds the measured pressures fixed, so it ignores how churn itself
 * changes who is left.
 */
export function projectChurn(causes: ChurnCauses, choices: readonly DriverWeightChoice[]): ChurnProjection {
  const by = new Map(choices.map((c) => [c.id, c]));
  let add = 0;
  const parts: [string, number][] = [];
  let marketW = 0;
  let marketPressure = 0;
  for (const c of causes.causes) {
    const choice = by.get(c.id) ?? { id: c.id, weight: c.weight, enabled: c.enabled };
    if (!choice.enabled) {
      parts.push([c.id, 0]);
      continue;
    }
    if (c.id === "market") {
      marketW = choice.weight;
      marketPressure = c.pressure;
      parts.push([c.id, 0]);
      continue;
    }
    const v = Math.max(0, choice.weight * c.pressure);
    add += v;
    parts.push([c.id, v]);
  }
  const a = 1 + add;
  const b = marketW > 0 ? Math.max(0, 1 + marketW * marketPressure) : 1;
  const marketPart = b > 1 ? a * (b - 1) : 0;
  const total = a + marketPart;
  const shares: Record<string, number> = {};
  for (const [id, v] of parts) shares[id] = id === "market" ? marketPart / total : v / total;
  return { clientsPerMonth: causes.baseClientsPerMonth * a * b, shares, normalShare: 1 / total };
}
