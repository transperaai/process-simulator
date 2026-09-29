// Discrete-event Monte Carlo simulation, ported from the Northbeam
// prototype's `ProcessSim` (prototype/northbeam-process-simulator.html).
// Fixed so far (docs/PRD.md §6.8): separate random streams per purpose, a
// binary-heap event queue, and dispatch to named people. Still as in the
// prototype, and fixed in later tickets: stale ongoing utilisation, empty start.

import { EventQueue } from "./event-queue";
import type {
  Distribution,
  EngineModel,
  EnginePerson,
  EngineStep,
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
import { expo, lognormal, Streams, triangular, type Rng } from "./random";

/** Minimum share of a person's time left for pipeline work, unless the model sets one. */
export const DEFAULT_AVAILABILITY_FLOOR = 0.08;
const DEFAULT_WORK_DIST: Distribution = { kind: "lognormal", cv: 0.35 };
const DEFAULT_WAIT_DIST: Distribution = { kind: "lognormal", cv: 0.3 };
const WEEKS_PER_MONTH = 4.33;
/** Stride between replication seeds. */
const SEED_STRIDE = 7919;

interface SimEntity extends TraceEntity {
  seg: TraceSegment | null;
}

type SimEvent =
  | { t: number; type: "arrive" }
  | { t: number; type: "week" }
  | { t: number; type: "back"; person: string }
  | { t: number; type: "end" | "leave"; e: SimEntity; step: string };

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
  steps: EngineStep[];
}

export function runOnce(model: EngineModel, seed: number, keepTrace: boolean): ReplicationResult {
  const streams = new Streams(seed);
  const H = model.horizonWeeks * model.hoursPerWeek;
  const floor = model.availabilityFloor ?? DEFAULT_AVAILABILITY_FLOOR;
  const steps = new Map<string, EngineStep>(model.steps.map((s) => [s.id, s]));
  const peopleModel = resolvePeople(model);

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
    steps: model.steps.filter((s) => canDo(id, person, s)),
  }));
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const stepPeople: Record<string, PersonState[]> = {};
  for (const s of model.steps) stepPeople[s.id] = people.filter((p) => p.steps.includes(s));

  // Capacity per role: each person's capacity split evenly across their roles.
  const roleCapacity: Record<string, number> = {};
  const roleMembers: Record<string, PersonState[]> = {};
  for (const rid in model.roles) {
    roleCapacity[rid] = 0;
    roleMembers[rid] = [];
  }
  for (const p of people) {
    for (const rid of p.person.roles) {
      if (!(rid in roleCapacity)) continue;
      roleCapacity[rid]! += p.person.capacity / p.person.roles.length;
      roleMembers[rid]!.push(p);
    }
  }
  const roleBusyHours: Record<string, number> = {};
  for (const rid in model.roles) roleBusyHours[rid] = 0;

  const stepStat: Record<string, StepStat> = {};
  const stepQueue: Record<string, SimEntity[]> = {};
  const stepRng: Record<string, { work: Rng; wait: Rng; rework: Rng; route: Rng }> = {};
  for (const s of model.steps) {
    stepStat[s.id] = { arrivals: 0, qLen: 0, qArea: 0, qLast: 0, qMax: 0, waitSum: 0, waitN: 0, reworks: 0 };
    stepQueue[s.id] = [];
    stepRng[s.id] = {
      work: streams.get(`work:${s.id}`),
      wait: streams.get(`wait:${s.id}`),
      rework: streams.get(`rework:${s.id}`),
      route: streams.get(`route:${s.id}`),
    };
  }
  let active = model.activeClients;
  const events = new EventQueue<SimEvent>();
  const entities: SimEntity[] = [];
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
  /** Share of a working week this person has for pipeline work. */
  const availFrac = (p: PersonState) =>
    Math.max(floor, (p.person.capacity - ongoingHours(p, active)) / model.hoursPerWeek);
  const onLeave = (p: PersonState, t: number) => p.person.leave?.some(([a, b]) => t >= a && t < b) ?? false;

  const setQ = (sid: string, t: number, delta: number) => {
    const st = stepStat[sid]!;
    st.qArea += st.qLen * (t - st.qLast);
    st.qLast = t;
    st.qLen += delta;
    if (st.qLen > st.qMax) st.qMax = st.qLen;
  };

  function enter(e: SimEntity, sid: string, t: number) {
    if (sid === model.sinks.won) {
      won++;
      cycle.push(t - e.t0);
      e.done = t;
      e.outcome = "won";
      active += 1;
      return;
    }
    if (sid === model.sinks.lost) {
      lost++;
      e.done = t;
      e.outcome = "lost";
      return;
    }
    const s = steps.get(sid)!;
    stepStat[sid]!.arrivals++;
    const seg: TraceSegment = { step: sid, person: null, tQ: t, tS: null, tE: null, tL: null };
    if (keepTrace) e.trace.push(seg);
    e.seg = seg;
    if (!s.role && !s.person) {
      startService(e, s, null, t);
      return;
    }
    stepQueue[sid]!.push(e);
    setQ(sid, t, 1);
    // Give it to the longest-idle eligible person, if anyone is free.
    let pick: PersonState | null = null;
    for (const p of stepPeople[sid]!) {
      if (!p.busy && !onLeave(p, t) && (!pick || p.freeSince < pick.freeSince)) pick = p;
    }
    if (pick) takeNext(pick, t);
  }

  /** A free person takes the oldest waiting item across the steps they can do (FIFO across steps). */
  function takeNext(p: PersonState, t: number) {
    if (p.busy || onLeave(p, t)) return;
    let best: SimEntity | null = null;
    let bestStep: EngineStep | null = null;
    for (const s of p.steps) {
      const c = stepQueue[s.id]![0];
      if (c && (!best || c.seg!.tQ < best.seg!.tQ)) {
        best = c;
        bestStep = s;
      }
    }
    if (!best || !bestStep) return;
    stepQueue[bestStep.id]!.shift();
    setQ(bestStep.id, t, -1);
    stepStat[bestStep.id]!.waitSum += t - best.seg!.tQ;
    stepStat[bestStep.id]!.waitN++;
    startService(best, bestStep, p, t);
  }

  function startService(e: SimEntity, s: EngineStep, p: PersonState | null, t: number) {
    e.seg!.tS = t;
    e.seg!.person = p?.id ?? null;
    let dur = 0;
    if (p) {
      p.busy = true;
      const frac = availFrac(p);
      const handsOn = sampleDuration(stepRng[s.id]!.work, s.work, s.workDist ?? DEFAULT_WORK_DIST);
      dur = handsOn / frac;
      p.busyHours += handsOn;
      if (s.role && s.role in roleBusyHours) roleBusyHours[s.role]! += handsOn;
    }
    push({ t: t + dur, type: "end", e, step: s.id });
  }

  function endService(e: SimEntity, s: EngineStep, t: number) {
    e.seg!.tE = t;
    const p = e.seg!.person ? peopleById.get(e.seg!.person)! : null;
    if (p) {
      p.busy = false;
      p.freeSince = t;
      p.completed++;
    }
    const waitDist = s.waitDist ?? DEFAULT_WAIT_DIST;
    const w = s.wait || waitDist.kind === "triangular" ? sampleDuration(stepRng[s.id]!.wait, s.wait, waitDist) : 0;
    push({ t: t + w, type: "leave", e, step: s.id });
    if (p) takeNext(p, t);
  }

  function leave(e: SimEntity, s: EngineStep, t: number) {
    e.seg!.tL = t;
    if (s.rework && stepRng[s.id]!.rework() < s.rework) {
      stepStat[s.id]!.reworks++;
      enter(e, s.id, t);
      return;
    }
    const u = stepRng[s.id]!.route();
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

  // Arrivals: Poisson process over the horizon.
  const arrivals = streams.get("arrivals");
  const meanGap = model.hoursPerWeek / model.leadsPerWeek;
  let ta = expo(arrivals, meanGap);
  while (ta < H) {
    push({ t: ta, type: "arrive" });
    ta += expo(arrivals, meanGap);
  }
  // Weekly churn ticks.
  for (let w = 1; w <= model.horizonWeeks; w++) push({ t: w * model.hoursPerWeek, type: "week" });
  // People coming back from leave pick up waiting work.
  for (const p of people) for (const [, end] of p.person.leave ?? []) if (end < H) push({ t: end, type: "back", person: p.id });

  for (let ev = events.pop(); ev; ev = events.pop()) {
    if (ev.t > H) break;
    if (ev.type === "arrive") {
      const e: SimEntity = { id: eid++, t0: ev.t, trace: [], seg: null };
      entities.push(e);
      enter(e, model.entry, ev.t);
    } else if (ev.type === "end") {
      endService(ev.e, steps.get(ev.step)!, ev.t);
    } else if (ev.type === "leave") {
      leave(ev.e, steps.get(ev.step)!, ev.t);
    } else if (ev.type === "back") {
      takeNext(peopleById.get(ev.person)!, ev.t);
    } else {
      active = Math.max(0, active - active * (model.churnMonthly / WEEKS_PER_MONTH));
    }
  }

  const stepOut: Record<string, StepResult> = {};
  for (const s of model.steps) {
    const st = stepStat[s.id]!;
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
  for (let i = 0; i < reps; i++) {
    const r = runOnce(model, seed + i * SEED_STRIDE, i === 0);
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
  };
}
