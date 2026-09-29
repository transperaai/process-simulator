// Engine input and output shapes. This is the prototype's model, kept as-is for
// the walking skeleton; later tickets replace role head-counts with named
// people, add services, clients and servicing (docs/PRD.md §6).

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
  /** Target step id, or one of the sink ids. */
  to: string;
  /** Branch probability; a step's edges sum to 1. */
  p: number;
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
  /** Monthly retainer price per won client. */
  retainer: number;
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
  sinks: { won: string; lost: string };
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
  done?: number;
  outcome?: "won" | "lost";
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

export interface ReplicationResult {
  won: number;
  lost: number;
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
  labour: Stat;
  /** Over replications that won at least one item. */
  costPerWin: Stat;
  mrrAdded: Stat;
  wipEnd: Stat;
  /** Over every completed item in every replication. */
  cycle: { mean: number; p50: number; p90: number };
  roles: Record<string, { util: Stat; pipeline: Stat; ongoing: Stat }>;
  people: Record<string, { util: Stat; pipeline: Stat; ongoing: Stat }>;
}

export interface SimulationResult {
  /** Means and ranges; the flat fields below are the prototype's shape, kept for compatibility. */
  kpi: Kpis;
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
