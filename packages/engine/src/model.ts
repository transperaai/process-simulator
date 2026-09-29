// Engine input and output shapes. This is the prototype's model, extended so
// far with named people, services and end-step outcomes; later tickets add
// clients and servicing (docs/PRD.md §6).

/** Times are in working hours. */
export interface EngineRole {
  name: string;
  /** Number of interchangeable people in the role; used only when the model has no `people`. */
  count: number;
  /** Cost per hour. */
  cost: number;
  /** Ongoing (retainer) hours per active client per week. */
  ongoing: number;
}

/**
 * How a duration varies around its mean. Triangular uses its own bounds, so
 * its mean is (min + mode + max) / 3.
 */
export type Distribution =
  | { kind: "lognormal"; cv: number }
  | { kind: "exponential" }
  | { kind: "constant" }
  | { kind: "triangular"; min: number; mode: number; max: number };

/** A named person who does the work (docs/PRD.md §6.3.3). */
export interface EnginePerson {
  name: string;
  /** Role ids; ongoing client load and utilisation roll up to these roles. */
  roles: string[];
  /** Working hours per week (FTE × the workspace's hours per week). */
  capacity: number;
  /** Step ids this person can perform; omitted means every step of their roles. */
  skills?: string[];
  /** Leave windows as [start, end) in simulation hours; no new work starts during leave. */
  leave?: [number, number][];
}

export interface EngineEdge {
  /** Target step id, or an end id (a sink or a key of `ends`). */
  to: string;
  /** Branch probability; a step's edges sum to 1. */
  p: number;
  /**
   * Condition tag (docs/PRD.md §6.3.6): tagged edges take precedence for
   * entities whose service carries the tag; the others split between the
   * untagged edges (see `routeFor` in simulate.ts). Ignored when the model
   * has no services.
   */
  tag?: string;
}

/** What reaching an end step means (docs/PRD.md §6.4, decision D8). */
export type Outcome = "won" | "lost" | "done";

/**
 * An end step beyond the two `sinks`. With `handoff`, the entity carries on
 * at that step: this is how a pipeline's `won` end chains into a downstream
 * process (onboarding, delivery) once processes are flattened into one model.
 */
export interface EngineEnd {
  outcome: Outcome;
  /** Step the entity continues at, e.g. the entry of a downstream process. */
  handoff?: string;
}

/**
 * How a service is priced. Only retainers add MRR; hourly services bill
 * through servicing work, which the engine does not simulate yet, so for now
 * they add nothing to the revenue KPIs.
 */
export type PricingModel = "retainer" | "one_off" | "hourly";

/** Something the business sells (docs/PRD.md §5 `services`). */
export interface EngineService {
  name: string;
  pricingModel: PricingModel;
  /** Monthly fee for a retainer; the whole fee for a one-off; the rate for hourly. */
  price: number;
  /** Gross margin as a share of price (0–1); carried for reporting, not used by the KPIs yet. */
  margin: number;
  /** Expected tenure of a retainer client, in months (LTV and lost revenue). */
  tenureMonths: number;
  /** Base monthly churn of a client on this service; billed-in-horizon is net of it. */
  churnMonthly: number;
  /** Relative share of arrivals; shares are normalised over the model's services. */
  mixShare: number;
  /** Step this service's arrivals enter at; defaults to the model's `entry`. */
  entry?: string;
  /** Condition tags this service's entities follow (see `EngineEdge.tag`). */
  pathTags: string[];
}

export interface EngineStep {
  id: string;
  name: string;
  /** Role that performs the step; null for pure waits/decisions. */
  role: string | null;
  /** Pinned assignee: only this person works the step. */
  person?: string | null;
  /** Mean hands-on hours. */
  work: number;
  /** Mean external wait after service, in hours. */
  wait: number;
  /** Probability of repeating the step. */
  rework: number;
  /** Defaults to lognormal with CV 0.35. */
  workDist?: Distribution;
  /** Defaults to lognormal with CV 0.3. */
  waitDist?: Distribution;
  /**
   * Items sitting at this step when the run starts (docs/PRD.md §6.3.1).
   * Entering WIP at any step starts the run from it instead of a warm-up.
   */
  currentWip?: number;
  next: EngineEdge[];
}

export interface EngineModel {
  horizonWeeks: number;
  hoursPerWeek: number;
  leadsPerWeek: number;
  activeClients: number;
  churnMonthly: number;
  /**
   * Monthly retainer price per won client. Used only when the model has no
   * `services`: then every entity is on one implicit retainer at this price,
   * churning at `churnMonthly`, with an expected tenure of 1 / `churnMonthly`
   * months (none, so no LTV, when churn is 0).
   */
  retainer: number;
  /**
   * Services by id. Each arrival is tagged with one, drawn from the mix, and
   * is routed and priced by it. Omitted or empty: the implicit retainer above.
   */
  services?: Record<string, EngineService>;
  roles: Record<string, EngineRole>;
  /** Named people. When omitted, each role gets `count` anonymous people. */
  people?: Record<string, EnginePerson>;
  /** Minimum share of a person's time left for pipeline work (default 0.08). */
  availabilityFloor?: number;
  /**
   * Warm-up run before measuring, in weeks, discarded from every reported
   * metric. Omitted means automatic: 4 weeks, or 2x the P90 cycle time of a
   * pilot run if longer (capped at 52 weeks). 0 starts from an empty business.
   * Ignored when any step has `currentWip`: the run starts from that instead.
   */
  warmupWeeks?: number;
  entry: string;
  /** The terminal `won` and `lost` end steps' ids. */
  sinks: { won: string; lost: string };
  /** Further end steps by id: more `won`/`lost` ends, `done` ends, and hand-offs. */
  ends?: Record<string, EngineEnd>;
  steps: EngineStep[];
}

/**
 * How a run started (docs/PRD.md §6.3.1): from entered work in progress, after
 * a discarded warm-up, or from an empty business (warm-up switched off).
 */
export type InitialState =
  | { kind: "wip"; items: number }
  | { kind: "warmup"; hours: number }
  | { kind: "empty" };

/** One visit of an entity to a step: queued, started, ended service, left. */
export interface TraceSegment {
  step: string;
  /** Who served it; null for steps with no resource. */
  person: string | null;
  tQ: number;
  tS: number | null;
  tE: number | null;
  tL: number | null;
}

export interface TraceEntity {
  id: number;
  t0: number;
  trace: TraceSegment[];
  /** When it reached a terminal end step. */
  done?: number;
  /** A win sticks: once won, later ends downstream don't change it. */
  outcome?: Outcome;
  /** Its service id, when the model has services. */
  service?: string;
}

export interface StepResult {
  arrivals: number;
  avgQueue: number;
  maxQueue: number;
  avgWait: number;
  reworks: number;
  /** Items still queued at the horizon. */
  wip: number;
}

export interface RoleResult {
  /** Share of capacity spent on pipeline work. */
  pipeline: number;
  /** Share of capacity spent on ongoing client work. */
  ongoing: number;
  /** Total utilisation (pipeline + ongoing). */
  util: number;
  pipelineHours: number;
  ongoingHours: number;
}

export interface PersonResult {
  /** Total utilisation: (pipeline + ongoing hours) / capacity. */
  util: number;
  pipeline: number;
  ongoing: number;
  pipelineHours: number;
  ongoingHours: number;
  /** Services completed. */
  completed: number;
}

/** Per-service counts in one replication. */
export interface ServiceCounts {
  arrivals: number;
  won: number;
  lost: number;
}

export interface ReplicationResult {
  /** Entities reaching their first `won` end. */
  won: number;
  /** Entities reaching a `lost` end without having been won. */
  lost: number;
  /** Entities reaching a `done` end without having been won. */
  done: number;
  /** Revenue KPIs (docs/PRD.md §13); see `Kpis`. */
  newMrr: number;
  billed: number;
  ltvAdded: number;
  lostRevenue: number;
  /** By service id; empty when the model has no services. */
  services: Record<string, ServiceCounts>;
  /** Cycle times of won and done entities. */
  cycle: number[];
  steps: Record<string, StepResult>;
  roles: Record<string, RoleResult>;
  people: Record<string, PersonResult>;
  /**
   * Entities in the measured window (replication 0 only). Those that entered
   * during the warm-up or as starting WIP have negative times.
   */
  entities: TraceEntity[] | null;
  H: number;
  /** Warm-up simulated before t = 0 and discarded. */
  warmupHours: number;
  activeEnd: number;
}

/** A metric across replications: the mean and the 10th–90th percentile band. */
export interface Stat {
  mean: number;
  p10: number;
  p90: number;
}

/** Headline metrics with their spread across replications (docs/PRD.md §6.4). */
export interface Kpis {
  won: Stat;
  lost: Stat;
  done: Stat;
  labour: Stat;
  /** Over replications that won at least one item. */
  costPerWin: Stat;
  /** New MRR: Σ over entities reaching their first `won` end of their service's price (retainers only). */
  mrrAdded: Stat;
  /**
   * Revenue billed in the horizon: Σ over clients won in the measured window
   * of weeks active before the horizon × weekly price (monthly / 4.33), net of
   * the service's churn (the weekly decay the engine applies to active
   * clients); a one-off bills its price when won. The starting clients are not
   * included until the engine has a client roster (docs/PRD.md decision D13).
   */
  billed: Stat;
  /** LTV added: Σ over new wins of price × expected tenure (retainers) or price (one-off). */
  ltvAdded: Stat;
  /** Lost revenue: Σ over lost entities of their service's expected value (as for LTV). */
  lostRevenue: Stat;
  wipEnd: Stat;
  /** Over every completed item in every replication. */
  cycle: { mean: number; p50: number; p90: number };
  roles: Record<string, { util: Stat; pipeline: Stat; ongoing: Stat }>;
  people: Record<string, { util: Stat; pipeline: Stat; ongoing: Stat }>;
  /** By service id; empty when the model has no services. */
  services: Record<string, { arrivals: Stat; won: Stat; lost: Stat }>;
}

/**
 * Headline metrics per replication, in replication order. Replication i of
 * every run with the same seed uses the same random streams, so two runs'
 * samples pair up for a delta's range (common random numbers; see compare.ts).
 */
export interface ReplicationSamples {
  won: number[];
  lost: number[];
  mrrAdded: number[];
  billed: number[];
  labour: number[];
  wipEnd: number[];
  /** Mean cycle time of the replication's completed items (0 when none completed). */
  cycleMean: number[];
}

export interface SimulationResult {
  /** Means and ranges; the flat fields below are the prototype's shape, kept for compatibility. */
  kpi: Kpis;
  /** Per-replication values behind `kpi`, for paired comparisons. */
  samples: ReplicationSamples;
  /** The seed the run started from. */
  seed: number;
  won: number;
  wonLow: number;
  wonHigh: number;
  lost: number;
  cycleP50: number;
  cycleP90: number;
  steps: Record<string, StepResult>;
  roles: Record<string, RoleResult>;
  people: Record<string, PersonResult>;
  /** The resolved people the run used (named, or synthesised from role counts). */
  resolvedPeople: Record<string, EnginePerson>;
  labour: number;
  costPerWin: number;
  /** Mean new MRR (`kpi.mrrAdded.mean`). */
  mrrAdded: number;
  bnRole: string | null;
  bnStep: string | null;
  /** Person with the highest utilisation. */
  bnPerson: string | null;
  /** Replication 0's entities, for animation. */
  trace: TraceEntity[] | null;
  H: number;
  reps: number;
  wipEnd: number;
  /** Whether the run started from entered WIP, a warm-up, or empty. */
  initialState: InitialState;
}
