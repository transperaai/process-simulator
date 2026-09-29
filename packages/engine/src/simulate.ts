// Discrete-event Monte Carlo simulation, ported from the Northbeam
// prototype's `ProcessSim` (prototype/northbeam-process-simulator.html).
// Fixed so far (docs/PRD.md §6.8): separate random streams per purpose, a
// binary-heap event queue, dispatch to named people, and a start from current
// WIP or a discarded warm-up instead of an empty business. Still as in the
// prototype, and fixed in a later ticket: stale ongoing utilisation.
//
// Time runs from -warmup to H; everything reported is measured over [0, H].

import { EventQueue } from "./event-queue";
import type {
  Distribution,
  EngineModel,
  EnginePerson,
  EngineStep,
  InitialState,
  Kpis,
  PersonResult,
  ReplicationResult,
  RoleResult,
  Stat,
  SimulationResult,
  StepResult,
  TraceEntity,
  TraceSegment,
} from "./model";
import { expo, lognormal, lognormalSampler, Streams, triangular, type Rng } from "./random";

/** Minimum share of a person's time left for pipeline work, unless the model sets one. */
export const DEFAULT_AVAILABILITY_FLOOR = 0.08;
const DEFAULT_WORK_DIST: Distribution = { kind: "lognormal", cv: 0.35 };
const DEFAULT_WAIT_DIST: Distribution = { kind: "lognormal", cv: 0.3 };
const WEEKS_PER_MONTH = 4.33;
/** Stride between replication seeds. */
const SEED_STRIDE = 7919;
/** Automatic warm-up: at least this many weeks (docs/PRD.md §6.3.1)... */
const DEFAULT_WARMUP_WEEKS = 4;
/** ...or twice the pilot run's P90 cycle time if longer, up to this cap. */
const MAX_WARMUP_WEEKS = 52;
/** Seed of the pilot run that sizes the automatic warm-up; fixed, so the warm-up is a property of the model. */
const PILOT_SEED = 1;

interface SimEntity extends TraceEntity {
  seg: TraceSegment | null;
}

type SimEvent =
  | { t: number; type: "arrive" }
  | { t: number; type: "week" }
  | { t: number; type: "measure" }
  | { t: number; type: "back"; p: PersonState }
  | { t: number; type: "end"; e: SimEntity; st: StepState; p: PersonState | null }
  | { t: number; type: "leave"; e: SimEntity; st: StepState };

interface StepStat {
  arrivals: number;
  qLen: number;
  qArea: number;
  qLast: number;
  qMax: number;
  waitSum: number;
  waitN: number;
  reworks: number;
}

/** A step's run-time state: its statistics, queue, who can work it, and its random streams. */
interface StepState {
  s: EngineStep;
  stat: StepStat;
  queue: SimEntity[];
  /** Eligible people; unstaffed for pure waits and decisions. */
  people: PersonState[];
  staffed: boolean;
  work: () => number;
  /** Null when the step has no external wait. */
  wait: (() => number) | null;
  rework: Rng;
  route: Rng;
}

/** Repeated duration draws with the given mean (same values as `sampleDuration`). */
function durationSampler(rng: Rng, mean: number, dist: Distribution): () => number {
  if (dist.kind === "lognormal") return lognormalSampler(rng, mean, dist.cv);
  return () => sampleDuration(rng, mean, dist);
}

/** Sample a duration with the given mean. */
export function sampleDuration(rng: Rng, mean: number, dist: Distribution): number {
  switch (dist.kind) {
    case "constant":
      return mean;
    case "exponential":
      return mean > 0 ? expo(rng, mean) : 0;
    case "lognormal":
      return lognormal(rng, mean, dist.cv);
    case "triangular":
      return triangular(rng, dist.min, dist.mode, dist.max);
  }
}

/** The model's people, or one anonymous person per role head-count when it has none. */
export function resolvePeople(model: EngineModel): Record<string, EnginePerson> {
  if (model.people && Object.keys(model.people).length) return model.people;
  const people: Record<string, EnginePerson> = {};
  for (const rid in model.roles) {
    const role = model.roles[rid]!;
    const count = Math.max(1, role.count);
    for (let i = 1; i <= count; i++) {
      people[`${rid}#${i}`] = { name: `${role.name} ${i}`, roles: [rid], capacity: model.hoursPerWeek };
    }
  }
  return people;
}

interface PersonState {
  id: string;
  person: EnginePerson;
  busy: boolean;
  /** When they last became free; the longest-idle eligible person gets new work. */
  freeSince: number;
  busyHours: number;
  completed: number;
  steps: StepState[];
  leave: [number, number][] | null;
  /** Pipeline share of the week, cached for the client count it was computed at. */
  frac: number;
  fracAt: number;
  /** The service in progress, so hands-on time straddling the end of the warm-up can be split. */
  cur: { start: number; end: number; handsOn: number; role: string | null } | null;
}

/** True when any step has current WIP entered (0 counts: "nothing here right now"). */
function hasWip(model: EngineModel): boolean {
  return model.steps.some((s) => s.currentWip != null);
}

/**
 * How a run starts (docs/PRD.md §6.3.1): from entered WIP if any step has it;
 * otherwise after a warm-up of `warmupWeeks`, or an automatic one (4 weeks,
 * extended to 2x the P90 cycle time of a pilot run from empty, capped at 52
 * weeks; the cap too when nothing completes in the pilot).
 */
export function initialState(model: EngineModel): InitialState {
  if (hasWip(model)) {
    return { kind: "wip", items: model.steps.reduce((a, s) => a + wipCount(s), 0) };
  }
  const hours =
    model.warmupWeeks !== undefined ? Math.max(0, model.warmupWeeks) * model.hoursPerWeek : autoWarmupHours(model);
  return hours > 0 ? { kind: "warmup", hours } : { kind: "empty" };
}

/** A pilot run from empty over the model's horizon; if nothing completes in it, the cap. */
function autoWarmupHours(model: EngineModel): number {
  const cap = MAX_WARMUP_WEEKS * model.hoursPerWeek;
  const pilot = runOnce(model, PILOT_SEED, false, { kind: "empty" });
  if (!pilot.cycle.length) return cap;
  return Math.min(cap, Math.max(DEFAULT_WARMUP_WEEKS * model.hoursPerWeek, 2 * pct(pilot.cycle, 0.9)));
}

const wipCount = (s: EngineStep) => Math.max(0, Math.floor(s.currentWip ?? 0));

export function runOnce(
  model: EngineModel,
  seed: number,
  keepTrace: boolean,
  start: InitialState = initialState(model),
): ReplicationResult {
  const streams = new Streams(seed);
  const H = model.horizonWeeks * model.hoursPerWeek;
  const W = start.kind === "warmup" ? start.hours : 0;
  const floor = model.availabilityFloor ?? DEFAULT_AVAILABILITY_FLOOR;
  const peopleModel = resolvePeople(model);

  const stepStates = new Map<string, StepState>();
  for (const s of model.steps) {
    const waitDist = s.waitDist ?? DEFAULT_WAIT_DIST;
    stepStates.set(s.id, {
      s,
      stat: { arrivals: 0, qLen: 0, qArea: 0, qLast: 0, qMax: 0, waitSum: 0, waitN: 0, reworks: 0 },
      queue: [],
      people: [],
      staffed: Boolean(s.role || s.person),
      work: durationSampler(streams.get(`work:${s.id}`), s.work, s.workDist ?? DEFAULT_WORK_DIST),
      wait:
        s.wait || waitDist.kind === "triangular" ? durationSampler(streams.get(`wait:${s.id}`), s.wait, waitDist) : null,
      rework: streams.get(`rework:${s.id}`),
      route: streams.get(`route:${s.id}`),
    });
  }
  const stepList = [...stepStates.values()];

  // Who can do what.
  const canDo = (pid: string, p: EnginePerson, s: EngineStep) =>
    s.person ? s.person === pid : p.skills ? p.skills.includes(s.id) : s.role !== null && p.roles.includes(s.role);
  const people: PersonState[] = Object.entries(peopleModel).map(([id, person]) => ({
    id,
    person,
    busy: false,
    freeSince: 0,
    busyHours: 0,
    completed: 0,
    steps: stepList.filter((st) => canDo(id, person, st.s)),
    leave: person.leave?.length ? person.leave : null,
    frac: 0,
    fracAt: NaN,
    cur: null,
  }));
  for (const st of stepList) st.people = people.filter((p) => p.steps.includes(st));

  // Capacity per role: each person's capacity split evenly across their roles.
  const roleCapacity: Record<string, number> = {};
  for (const rid in model.roles) roleCapacity[rid] = 0;
  for (const p of people) {
    for (const rid of p.person.roles) {
      if (!(rid in roleCapacity)) continue;
      roleCapacity[rid]! += p.person.capacity / p.person.roles.length;
    }
  }
  const roleBusyHours: Record<string, number> = {};
  for (const rid in model.roles) roleBusyHours[rid] = 0;

  let active = model.activeClients;
  const events = new EventQueue<SimEvent>();
  let entities: SimEntity[] = [];
  let eid = 0;
  const cycle: number[] = [];
  let won = 0;
  let lost = 0;

  const push = (ev: SimEvent) => events.push(ev);

  /** Ongoing client hours per week a person carries, shared across each role's members by capacity. */
  const ongoingHours = (p: PersonState, clients: number) => {
    let hours = 0;
    for (const rid of p.person.roles) {
      const role = model.roles[rid];
      const cap = roleCapacity[rid];
      if (!role || !cap) continue;
      hours += (clients * (role.ongoing || 0) * (p.person.capacity / p.person.roles.length)) / cap;
    }
    return hours;
  };
  /** Share of a working week this person has for pipeline work (recomputed when the client count moves). */
  const availFrac = (p: PersonState) => {
    if (p.fracAt !== active) {
      p.frac = Math.max(floor, (p.person.capacity - ongoingHours(p, active)) / model.hoursPerWeek);
      p.fracAt = active;
    }
    return p.frac;
  };
  const onLeave = (p: PersonState, t: number) => {
    if (!p.leave) return false;
    for (const [a, b] of p.leave) if (t >= a && t < b) return true;
    return false;
  };

  const setQ = (st: StepStat, t: number, delta: number) => {
    st.qArea += st.qLen * (t - st.qLast);
    st.qLast = t;
    st.qLen += delta;
    if (st.qLen > st.qMax) st.qMax = st.qLen;
  };

  function enter(e: SimEntity, sid: string, t: number) {
    if (sid === model.sinks.won) {
      e.done = t;
      e.outcome = "won";
      // The warm-up runs at the starting client count; its wins are discarded.
      if (t < 0) return;
      won++;
      cycle.push(t - e.t0);
      active += 1;
      return;
    }
    if (sid === model.sinks.lost) {
      if (t >= 0) lost++;
      e.done = t;
      e.outcome = "lost";
      return;
    }
    const st = stepStates.get(sid)!;
    st.stat.arrivals++;
    queueAt(e, st, t, t);
  }

  /** Put an entity at a step (queued since `tQ`); the longest-idle eligible free person takes it. */
  function queueAt(e: SimEntity, st: StepState, tQ: number, t: number) {
    const seg: TraceSegment = { step: st.s.id, person: null, tQ, tS: null, tE: null, tL: null };
    if (keepTrace) e.trace.push(seg);
    e.seg = seg;
    if (!st.staffed) {
      startService(e, st, null, t);
      return;
    }
    st.queue.push(e);
    setQ(st.stat, t, 1);
    let pick: PersonState | null = null;
    for (const p of st.people) {
      if (!p.busy && !onLeave(p, t) && (!pick || p.freeSince < pick.freeSince)) pick = p;
    }
    if (pick) takeNext(pick, t);
  }

  /** A free person takes the oldest waiting item across the steps they can do (FIFO across steps). */
  function takeNext(p: PersonState, t: number) {
    if (p.busy || onLeave(p, t)) return;
    let best: SimEntity | null = null;
    let bestStep: StepState | null = null;
    for (const st of p.steps) {
      const c = st.queue[0];
      if (c && (!best || c.seg!.tQ < best.seg!.tQ)) {
        best = c;
        bestStep = st;
      }
    }
    if (!best || !bestStep) return;
    bestStep.queue.shift();
    const stat = bestStep.stat;
    setQ(stat, t, -1);
    stat.waitSum += t - best.seg!.tQ;
    stat.waitN++;
    startService(best, bestStep, p, t);
  }

  function startService(e: SimEntity, st: StepState, p: PersonState | null, t: number) {
    e.seg!.tS = t;
    e.seg!.person = p?.id ?? null;
    let dur = 0;
    if (p) {
      p.busy = true;
      const frac = availFrac(p);
      const handsOn = st.work();
      dur = handsOn / frac;
      p.busyHours += handsOn;
      const role = st.s.role;
      if (role && role in roleBusyHours) roleBusyHours[role]! += handsOn;
      p.cur = { start: t, end: t + dur, handsOn, role };
    }
    push({ t: t + dur, type: "end", e, st, p });
  }

  function endService(e: SimEntity, st: StepState, p: PersonState | null, t: number) {
    e.seg!.tE = t;
    if (p) {
      p.busy = false;
      p.freeSince = t;
      p.completed++;
    }
    const w = st.wait ? st.wait() : 0;
    push({ t: t + w, type: "leave", e, st });
    if (p) takeNext(p, t);
  }

  function leave(e: SimEntity, st: StepState, t: number) {
    e.seg!.tL = t;
    const s = st.s;
    if (s.rework && st.rework() < s.rework) {
      st.stat.reworks++;
      enter(e, s.id, t);
      return;
    }
    const u = st.route();
    let acc = 0;
    let to = s.next[s.next.length - 1]!.to;
    for (const n of s.next) {
      acc += n.p;
      if (u < acc) {
        to = n.to;
        break;
      }
    }
    enter(e, to, t);
  }

  /**
   * End of the warm-up: discard everything measured so far. Work in progress
   * carries over; hands-on time of a service in progress is split pro rata.
   */
  function startMeasuring() {
    won = 0;
    lost = 0;
    cycle.length = 0;
    active = model.activeClients;
    for (const { stat } of stepList) {
      Object.assign(stat, { arrivals: 0, qArea: 0, qLast: 0, qMax: stat.qLen, waitSum: 0, waitN: 0, reworks: 0 });
    }
    for (const rid in roleBusyHours) roleBusyHours[rid] = 0;
    for (const p of people) {
      p.busyHours = 0;
      p.completed = 0;
      const c = p.cur;
      if (!p.busy || !c || c.end <= 0 || c.end <= c.start) continue;
      const share = (c.handsOn * c.end) / (c.end - c.start);
      p.busyHours += share;
      if (c.role && c.role in roleBusyHours) roleBusyHours[c.role]! += share;
    }
    entities = entities.filter((e) => e.done === undefined);
  }

  /**
   * Starting WIP: each item queued at its step with an age drawn uniformly
   * over the step's expected wait (its mean wait, or its work time for steps
   * with none). Oldest first, so they are served before anything newer.
   */
  function seedWip() {
    const items: { st: StepState; tQ: number }[] = [];
    for (const st of stepList) {
      const rng = streams.get(`wip:${st.s.id}`);
      const span = st.s.wait > 0 ? st.s.wait : st.s.work;
      for (let i = 0; i < wipCount(st.s); i++) items.push({ st, tQ: 0 - rng() * span });
    }
    items.sort((a, b) => a.tQ - b.tQ);
    for (const { st, tQ } of items) {
      const e: SimEntity = { id: eid++, t0: tQ, trace: [], seg: null };
      entities.push(e);
      queueAt(e, st, tQ, 0);
    }
  }

  // Arrivals: Poisson process over the horizon. The warm-up's arrivals come
  // from their own stream, drawn backwards from t = 0, so the measured
  // window's arrivals are the same whatever the warm-up length. Only the next
  // arrival sits in the event queue, which keeps the heap small.
  const arrivalTimes: number[] = [];
  const meanGap = model.hoursPerWeek / model.leadsPerWeek;
  if (W > 0) {
    push({ t: 0, type: "measure" });
    const early = streams.get("arrivals:warmup");
    for (let tb = -expo(early, meanGap); tb >= -W; tb -= expo(early, meanGap)) arrivalTimes.push(tb);
    arrivalTimes.reverse();
  }
  const arrivals = streams.get("arrivals");
  for (let ta = expo(arrivals, meanGap); ta < H; ta += expo(arrivals, meanGap)) arrivalTimes.push(ta);
  let nextArrival = 0;
  const scheduleArrival = () => {
    if (nextArrival < arrivalTimes.length) push({ t: arrivalTimes[nextArrival++]!, type: "arrive" });
  };
  scheduleArrival();
  // Weekly churn ticks.
  for (let w = 1; w <= model.horizonWeeks; w++) push({ t: w * model.hoursPerWeek, type: "week" });
  // People coming back from leave pick up waiting work.
  for (const p of people) for (const [, end] of p.leave ?? []) if (end < H) push({ t: end, type: "back", p });
  if (start.kind === "wip") seedWip();

  for (let ev = events.pop(); ev; ev = events.pop()) {
    if (ev.t > H) break;
    if (ev.type === "arrive") {
      scheduleArrival();
      const e: SimEntity = { id: eid++, t0: ev.t, trace: [], seg: null };
      entities.push(e);
      enter(e, model.entry, ev.t);
    } else if (ev.type === "end") {
      endService(ev.e, ev.st, ev.p, ev.t);
    } else if (ev.type === "leave") {
      leave(ev.e, ev.st, ev.t);
    } else if (ev.type === "back") {
      takeNext(ev.p, ev.t);
    } else if (ev.type === "measure") {
      startMeasuring();
    } else {
      active = Math.max(0, active - active * (model.churnMonthly / WEEKS_PER_MONTH));
    }
  }

  const stepOut: Record<string, StepResult> = {};
  for (const s of model.steps) {
    const st = stepStates.get(s.id)!.stat;
    st.qArea += st.qLen * (H - st.qLast);
    stepOut[s.id] = {
      arrivals: st.arrivals,
      avgQueue: st.qArea / H,
      maxQueue: st.qMax,
      avgWait: st.waitN ? st.waitSum / st.waitN : 0,
      reworks: st.reworks,
      wip: st.qLen,
    };
  }
  // Ongoing load is reported from the starting client count, as in the
  // prototype (docs/PRD.md §6.8 item 2; fixed with the client roster).
  const roleOut: Record<string, RoleResult> = {};
  for (const rid in model.roles) {
    const cap = (roleCapacity[rid] ?? 0) * model.horizonWeeks;
    const ong = model.activeClients * (model.roles[rid]!.ongoing || 0) * model.horizonWeeks;
    const busy = roleBusyHours[rid]!;
    roleOut[rid] = {
      pipeline: cap ? busy / cap : 0,
      ongoing: cap ? ong / cap : 0,
      util: cap ? (busy + ong) / cap : 0,
      pipelineHours: busy / model.horizonWeeks,
      ongoingHours: ong / model.horizonWeeks,
    };
  }
  const peopleOut: Record<string, PersonResult> = {};
  for (const p of people) {
    const cap = p.person.capacity * model.horizonWeeks;
    const ong = ongoingHours(p, model.activeClients) * model.horizonWeeks;
    peopleOut[p.id] = {
      pipeline: cap ? p.busyHours / cap : 0,
      ongoing: cap ? ong / cap : 0,
      util: cap ? (p.busyHours + ong) / cap : 0,
      pipelineHours: p.busyHours / model.horizonWeeks,
      ongoingHours: ong / model.horizonWeeks,
      completed: p.completed,
    };
  }
  return {
    won,
    lost,
    cycle,
    steps: stepOut,
    roles: roleOut,
    people: peopleOut,
    entities: keepTrace ? entities.map(stripSeg) : null,
    H,
    warmupHours: W,
    activeEnd: active,
  };
}

function stripSeg({ seg: _seg, ...entity }: SimEntity): TraceEntity {
  return entity;
}

/** Value at percentile `p` (0–1) using the prototype's nearest-rank rule. */
export function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))]!;
}

/** Mean and 10th–90th percentile band of a set of values. */
export function stat(values: number[]): Stat {
  if (!values.length) return { mean: 0, p10: 0, p90: 0 };
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p10: pct(values, 0.1), p90: pct(values, 0.9) };
}

function kpis(model: EngineModel, runs: ReplicationResult[], cycle: number[]): Kpis {
  const labourOf = (r: ReplicationResult) => {
    let total = 0;
    for (const rid in model.roles) total += r.roles[rid]!.pipelineHours * model.horizonWeeks * model.roles[rid]!.cost;
    return total;
  };
  const labour = runs.map(labourOf);
  const roles: Kpis["roles"] = {};
  for (const rid in model.roles) {
    roles[rid] = {
      util: stat(runs.map((r) => r.roles[rid]!.util)),
      pipeline: stat(runs.map((r) => r.roles[rid]!.pipeline)),
      ongoing: stat(runs.map((r) => r.roles[rid]!.ongoing)),
    };
  }
  const people: Kpis["people"] = {};
  for (const pid in runs[0]?.people ?? {}) {
    people[pid] = {
      util: stat(runs.map((r) => r.people[pid]!.util)),
      pipeline: stat(runs.map((r) => r.people[pid]!.pipeline)),
      ongoing: stat(runs.map((r) => r.people[pid]!.ongoing)),
    };
  }
  return {
    won: stat(runs.map((r) => r.won)),
    lost: stat(runs.map((r) => r.lost)),
    labour: stat(labour),
    costPerWin: stat(runs.flatMap((r, i) => (r.won ? [labour[i]! / r.won] : []))),
    mrrAdded: stat(runs.map((r) => r.won * model.retainer)),
    wipEnd: stat(runs.map((r) => Object.values(r.steps).reduce((a, st) => a + st.wip, 0))),
    cycle: {
      mean: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : 0,
      p50: pct(cycle, 0.5),
      p90: pct(cycle, 0.9),
    },
    roles,
    people,
  };
}

export function simulate(model: EngineModel, reps = 30, seed = 1): SimulationResult {
  const runs: ReplicationResult[] = [];
  let trace: TraceEntity[] | null = null;
  const start = initialState(model);
  for (let i = 0; i < reps; i++) {
    const r = runOnce(model, seed + i * SEED_STRIDE, i === 0, start);
    if (i === 0) trace = r.entities;
    runs.push(r);
  }
  const n = runs.length;
  const avg = (f: (r: ReplicationResult) => number) => runs.reduce((a, r) => a + f(r), 0) / n;
  const cycle = runs.flatMap((r) => r.cycle);

  const steps: Record<string, StepResult> = {};
  for (const s of model.steps) {
    steps[s.id] = {
      arrivals: avg((r) => r.steps[s.id]!.arrivals),
      avgQueue: avg((r) => r.steps[s.id]!.avgQueue),
      maxQueue: avg((r) => r.steps[s.id]!.maxQueue),
      avgWait: avg((r) => r.steps[s.id]!.avgWait),
      reworks: avg((r) => r.steps[s.id]!.reworks),
      wip: avg((r) => r.steps[s.id]!.wip),
    };
  }
  const roles: Record<string, RoleResult> = {};
  for (const rid in model.roles) {
    roles[rid] = {
      pipeline: avg((r) => r.roles[rid]!.pipeline),
      ongoing: avg((r) => r.roles[rid]!.ongoing),
      util: avg((r) => r.roles[rid]!.util),
      pipelineHours: avg((r) => r.roles[rid]!.pipelineHours),
      ongoingHours: avg((r) => r.roles[rid]!.ongoingHours),
    };
  }
  const resolvedPeople = resolvePeople(model);
  const people: Record<string, PersonResult> = {};
  for (const pid in resolvedPeople) {
    people[pid] = {
      pipeline: avg((r) => r.people[pid]!.pipeline),
      ongoing: avg((r) => r.people[pid]!.ongoing),
      util: avg((r) => r.people[pid]!.util),
      pipelineHours: avg((r) => r.people[pid]!.pipelineHours),
      ongoingHours: avg((r) => r.people[pid]!.ongoingHours),
      completed: avg((r) => r.people[pid]!.completed),
    };
  }
  const wonArr = runs.map((r) => r.won);
  const won = avg((r) => r.won);
  const lost = avg((r) => r.lost);
  const H = model.horizonWeeks * model.hoursPerWeek;
  let labour = 0;
  for (const rid in model.roles) labour += roles[rid]!.pipelineHours * model.horizonWeeks * model.roles[rid]!.cost;

  // Bottleneck: role with highest utilisation; step with the largest average queue.
  let bnRole: string | null = null;
  for (const rid in roles) if (!bnRole || roles[rid]!.util > roles[bnRole]!.util) bnRole = rid;
  let bnPerson: string | null = null;
  for (const pid in people) if (!bnPerson || people[pid]!.util > people[bnPerson]!.util) bnPerson = pid;
  let bnStep: string | null = null;
  for (const s of model.steps) {
    if (s.role && (!bnStep || steps[s.id]!.avgQueue > steps[bnStep]!.avgQueue)) bnStep = s.id;
  }

  return {
    kpi: kpis(model, runs, cycle),
    won,
    wonLow: pct(wonArr, 0.1),
    wonHigh: pct(wonArr, 0.9),
    lost,
    cycleP50: pct(cycle, 0.5),
    cycleP90: pct(cycle, 0.9),
    steps,
    roles,
    people,
    resolvedPeople,
    labour,
    costPerWin: won ? labour / won : 0,
    mrrAdded: won * model.retainer,
    bnRole,
    bnStep,
    bnPerson,
    trace,
    H,
    reps,
    wipEnd: model.steps.reduce((a, s) => a + steps[s.id]!.wip, 0),
    initialState: start,
  };
}
