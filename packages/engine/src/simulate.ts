// Discrete-event Monte Carlo simulation, ported from the Northbeam
// prototype's `ProcessSim` (prototype/northbeam-process-simulator.html).
// Fixed so far (docs/PRD.md §6.8): separate random streams per purpose, a
// binary-heap event queue, dispatch to named people, a start from current
// WIP or a discarded warm-up instead of an empty business, and revenue priced
// per service and booked once per entity at its first win. Still as in the
// prototype, and fixed in a later ticket: stale ongoing utilisation.
//
// Time runs from -warmup to H; everything reported is measured over [0, H].

import { arrivalTimes as drawArrivals } from "./demand";
import { EventQueue } from "./event-queue";
import type {
  Distribution,
  EngineEdge,
  EngineEnd,
  EngineModel,
  EnginePerson,
  EngineService,
  EngineStep,
  InitialState,
  Kpis,
  Outcome,
  PersonResult,
  ReplicationResult,
  RoleResult,
  ServiceCounts,
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
  /** Index of its service in the run's service list. */
  svc: number;
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
  /** Edges to choose from per service index, when any edge is condition-tagged; null otherwise. */
  routes: Route[] | null;
}

/** The edges an entity picks from at a step, and their total probability. */
interface Route {
  next: EngineEdge[];
  total: number;
}

/** A service as a run uses it. */
interface ServiceState {
  /** Null for the implicit retainer of a model without services. */
  id: string | null;
  s: EngineService;
  entry: string;
  /** Expected value of one client: price × tenure (retainer), price (one-off), nothing (hourly). */
  value: number;
  counts: ServiceCounts;
}

/**
 * The model's services, or one implicit retainer at `model.retainer` when it
 * has none, so such a model's revenue is `won × retainer` as before.
 */
function resolveServices(model: EngineModel): ServiceState[] {
  const given = Object.entries(model.services ?? {});
  const churn = model.churnMonthly;
  const entries: [string | null, EngineService][] = given.length
    ? given
    : [
        [
          null,
          {
            name: "Retainer",
            pricingModel: "retainer",
            price: model.retainer,
            margin: 0,
            tenureMonths: churn > 0 ? 1 / churn : 0,
            churnMonthly: churn,
            mixShare: 1,
            pathTags: [],
          },
        ],
      ];
  return entries.map(([id, s]) => ({
    id,
    s,
    entry: s.entry ?? model.entry,
    value: s.pricingModel === "retainer" ? s.price * s.tenureMonths : s.pricingModel === "one_off" ? s.price : 0,
    counts: { arrivals: 0, won: 0, lost: 0 },
  }));
}

/**
 * Which of a step's edges an entity on this service picks from. Tagged edges
 * take precedence: the entity follows the edges tagged with one of its
 * service's path tags; if none match, the untagged edges; if the step has no
 * untagged edges either, all of them. Probabilities are renormalised within
 * the chosen edges (all of them: as entered). So `seo` and `ppc` tagged edges
 * split entities by service, and a `fast-track` tagged edge next to untagged
 * ones diverts only entities carrying that tag while the rest split between
 * the untagged edges in proportion to their probabilities.
 */
function routeFor(edges: EngineEdge[], tags: string[]): Route {
  const sum = (next: EngineEdge[]) => next.reduce((a, n) => a + n.p, 0);
  const tagged = edges.filter((n) => n.tag !== undefined && tags.includes(n.tag));
  if (tagged.length) return { next: tagged, total: sum(tagged) };
  const untagged = edges.filter((n) => n.tag === undefined);
  if (untagged.length) return { next: untagged, total: sum(untagged) };
  return { next: edges, total: 1 };
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
  const services = resolveServices(model);
  const hasServices = services[0]!.id !== null;
  for (const sv of services) {
    if (!(sv.s.mixShare >= 0)) throw new Error(`Service '${sv.s.name}' needs a mix share of 0 or more`);
  }
  const mixTotal = services.reduce((a, sv) => a + sv.s.mixShare, 0);
  if (!(mixTotal > 0)) throw new Error("The services' mix shares must add up to more than 0");
  /** Draw an arrival's service from the mix; always the implicit one when the model has none. */
  const drawService = (rng: Rng) => {
    if (!hasServices) return 0;
    const u = rng() * mixTotal;
    let acc = 0;
    for (let i = 0; i < services.length - 1; i++) {
      acc += services[i]!.s.mixShare;
      if (u < acc) return i;
    }
    return services.length - 1;
  };

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
      routes:
        hasServices && s.next.some((n) => n.tag !== undefined)
          ? services.map((sv) => routeFor(s.next, sv.s.pathTags))
          : null,
    });
  }
  // End steps: the two sinks, then any further ones (which may override them).
  const ends = new Map<string, EngineEnd>([
    [model.sinks.won, { outcome: "won" }],
    [model.sinks.lost, { outcome: "lost" }],
    ...Object.entries(model.ends ?? {}),
  ]);
  for (const sv of services) {
    if (!stepStates.has(sv.entry)) throw new Error(`Service '${sv.s.name}' enters at unknown step '${sv.entry}'`);
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
  let done = 0;
  let billed = 0;

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
    const st = stepStates.get(sid);
    if (st) {
      st.stat.arrivals++;
      queueAt(e, st, t, t);
      return;
    }
    const end = ends.get(sid);
    if (!end) throw new Error(`Edge to unknown step '${sid}'`);
    if (!end.handoff) e.done = t;
    reachEnd(e, end.outcome, t);
    if (end.handoff) enter(e, end.handoff, t);
  }

  /**
   * Record an outcome. A win sticks and is booked once, at the first `won`
   * end, priced by the entity's service (docs/PRD.md §6.4 revenue rules): a
   * won entity handed on to a downstream process books nothing more, and
   * isn't counted as lost or done if it ends there.
   */
  function reachEnd(e: SimEntity, outcome: Outcome, t: number) {
    if (e.outcome === "won" || e.outcome === outcome) return;
    e.outcome = outcome;
    // The warm-up runs at the starting client count; its outcomes are discarded.
    if (t < 0) return;
    const sv = services[e.svc]!;
    if (outcome === "won") {
      won++;
      sv.counts.won++;
      cycle.push(t - e.t0);
      // A one-off job doesn't become an ongoing client.
      if (sv.s.pricingModel !== "one_off") active += 1;
      if (sv.s.pricingModel === "retainer") {
        billed += (sv.s.price / WEEKS_PER_MONTH) * weeksBilled(t, sv.s.churnMonthly);
      } else if (sv.s.pricingModel === "one_off") {
        billed += sv.s.price;
      }
    } else if (outcome === "lost") {
      lost++;
      sv.counts.lost++;
    } else {
      done++;
      cycle.push(t - e.t0);
    }
  }

  /**
   * Expected weeks a client won at `t` is billed before the horizon: its
   * survival steps down at each weekly churn tick by the same factor the
   * engine applies to active clients.
   */
  function weeksBilled(t: number, churnMonthly: number): number {
    const hpw = model.hoursPerWeek;
    const first = (Math.floor(t / hpw) + 1) * hpw;
    if (first >= H) return (H - t) / hpw;
    // Ticks at `first`, a week later, ..., `last`: the n - 1 whole weeks
    // between them bill keep^1..keep^(n-1), the stub after `last` keep^n.
    const last = Math.ceil(H / hpw - 1) * hpw;
    const n = Math.round((last - first) / hpw) + 1;
    const keep = Math.max(0, 1 - churnMonthly / WEEKS_PER_MONTH);
    const keepN = powInt(keep, n);
    const whole = keep === 1 ? n - 1 : (keep - keepN) / (1 - keep);
    return (first - t) / hpw + whole + (keepN * (H - last)) / hpw;
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
    let u = st.route();
    let next = s.next;
    if (st.routes) {
      const r = st.routes[e.svc]!;
      next = r.next;
      u *= r.total;
    }
    let acc = 0;
    let to = next[next.length - 1]!.to;
    for (const n of next) {
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
    done = 0;
    billed = 0;
    for (const sv of services) sv.counts = { arrivals: 0, won: 0, lost: 0 };
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
    const mix = streams.get("mix:wip");
    const items: { st: StepState; tQ: number }[] = [];
    for (const st of stepList) {
      const rng = streams.get(`wip:${st.s.id}`);
      const span = st.s.wait > 0 ? st.s.wait : st.s.work;
      for (let i = 0; i < wipCount(st.s); i++) items.push({ st, tQ: 0 - rng() * span });
    }
    items.sort((a, b) => a.tQ - b.tQ);
    for (const { st, tQ } of items) {
      const e: SimEntity = { id: eid++, t0: tQ, trace: [], seg: null, svc: drawService(mix) };
      entities.push(e);
      queueAt(e, st, tQ, 0);
    }
  }

  // Arrivals: Poisson process over the horizon. The warm-up's arrivals come
  // from their own stream, drawn backwards from t = 0, so the measured
  // window's arrivals are the same whatever the warm-up length. Only the next
  // arrival sits in the event queue, which keeps the heap small. The rate
  // follows the calendar when the model has seasonality or growth (demand.ts).
  if (W > 0) push({ t: 0, type: "measure" });
  const arrivalTimes = drawArrivals(model, H, W, streams.get("arrivals"), streams.get("arrivals:warmup"));
  // Each arrival's service comes from the mix, on its own streams (warm-up and
  // measured window apart, as for the arrival times).
  const mixWarmup = streams.get("mix:warmup");
  const mix = streams.get("mix");
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
      const sv = drawService(ev.t < 0 ? mixWarmup : mix);
      const e: SimEntity = { id: eid++, t0: ev.t, trace: [], seg: null, svc: sv };
      entities.push(e);
      if (ev.t >= 0) services[sv]!.counts.arrivals++;
      enter(e, services[sv]!.entry, ev.t);
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
  // Revenue from the per-service counts (docs/PRD.md §13).
  let newMrr = 0;
  let ltvAdded = 0;
  let lostRevenue = 0;
  const serviceOut: Record<string, ServiceCounts> = {};
  for (const sv of services) {
    const { won: w, lost: l } = sv.counts;
    if (sv.s.pricingModel === "retainer") newMrr += w * sv.s.price;
    ltvAdded += w * sv.value;
    lostRevenue += l * sv.value;
    if (sv.id !== null) serviceOut[sv.id] = sv.counts;
  }
  const toTrace = ({ seg: _seg, svc, ...entity }: SimEntity): TraceEntity => {
    const id = services[svc]!.id;
    return id !== null ? { ...entity, service: id } : entity;
  };
  return {
    won,
    lost,
    done,
    newMrr,
    billed,
    ltvAdded,
    lostRevenue,
    services: serviceOut,
    cycle,
    steps: stepOut,
    roles: roleOut,
    people: peopleOut,
    entities: keepTrace ? entities.map(toTrace) : null,
    H,
    warmupHours: W,
    activeEnd: active,
  };
}

/** x^n for a whole n ≥ 0 by repeated squaring (plain multiplication, so identical in every JS engine). */
function powInt(x: number, n: number): number {
  let result = 1;
  for (let b = x, k = n; k > 0; k >>= 1, b *= b) if (k & 1) result *= b;
  return result;
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
  const services: Kpis["services"] = {};
  for (const sid in runs[0]?.services ?? {}) {
    services[sid] = {
      arrivals: stat(runs.map((r) => r.services[sid]!.arrivals)),
      won: stat(runs.map((r) => r.services[sid]!.won)),
      lost: stat(runs.map((r) => r.services[sid]!.lost)),
    };
  }
  return {
    won: stat(runs.map((r) => r.won)),
    lost: stat(runs.map((r) => r.lost)),
    done: stat(runs.map((r) => r.done)),
    labour: stat(labour),
    costPerWin: stat(runs.flatMap((r, i) => (r.won ? [labour[i]! / r.won] : []))),
    mrrAdded: stat(runs.map((r) => r.newMrr)),
    billed: stat(runs.map((r) => r.billed)),
    ltvAdded: stat(runs.map((r) => r.ltvAdded)),
    lostRevenue: stat(runs.map((r) => r.lostRevenue)),
    wipEnd: stat(runs.map((r) => Object.values(r.steps).reduce((a, st) => a + st.wip, 0))),
    cycle: {
      mean: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : 0,
      p50: pct(cycle, 0.5),
      p90: pct(cycle, 0.9),
    },
    roles,
    people,
    services,
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

  const kpi = kpis(model, runs, cycle);
  return {
    kpi,
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
    mrrAdded: kpi.mrrAdded.mean,
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
