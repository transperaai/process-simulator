// Engine input and output shapes. This is the prototype's model, kept as-is for
// the walking skeleton; later tickets replace role head-counts with named
// people, add services, clients and servicing (docs/PRD.md §6).

/** Times are in working hours. */
export interface EngineRole {
  name: string;
  /** Number of interchangeable people in the role. */
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
  entry: string;
  sinks: { won: string; lost: string };
  steps: EngineStep[];
}

/** One visit of an entity to a step: queued, started, ended service, left. */
export interface TraceSegment {
  step: string;
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

export interface ReplicationResult {
  won: number;
  lost: number;
  cycle: number[];
  steps: Record<string, StepResult>;
  roles: Record<string, RoleResult>;
  entities: TraceEntity[] | null;
  H: number;
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
  labour: number;
  costPerWin: number;
  mrrAdded: number;
  bnRole: string | null;
  bnStep: string | null;
  /** Replication 0's entities, for animation. */
  trace: TraceEntity[] | null;
  H: number;
  reps: number;
  wipEnd: number;
}
