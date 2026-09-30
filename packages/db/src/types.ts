// Row shapes the app and engine work with. The database shape itself lives in
// `database.types.ts` (generated: `pnpm --filter @transpera-flow/db gen:types`); these
// narrow its check-constrained text and jsonb columns, and the checks at the
// bottom fail the typecheck if they drift from it.

import type { IssueSeverity, IssueType, ScenarioPatch } from "@transpera-flow/engine";
import type { Database } from "./database.types";

export type MembershipRole = "agency_admin" | "owner" | "editor" | "member" | "viewer";
export type StepKind = "task" | "wait" | "decision" | "subprocess" | "start" | "end";
export type StepOutcome = "won" | "lost" | "done";
export type Distribution = "constant" | "triangular" | "lognormal";
export type PricingModel = "retainer" | "one_off" | "hourly";

/**
 * A step duration's distribution parameters (`work_params`, `wait_params`).
 * Lognormal reads `cv` (spread relative to the mean); triangular reads `min`,
 * `mode` and `max` in hours; constant reads nothing. Missing keys use defaults.
 * A type alias, not an interface, so it stays assignable to the jsonb column.
 */
export type DistParams = { cv?: number | null; min?: number | null; mode?: number | null; max?: number | null };

export interface WorkspaceSettings {
  hours_per_week: number;
  horizon_weeks: number;
  currency: string;
  /** Arrivals a week while the workspace has no lead sources; the other three are interim until services and clients land. */
  leads_per_week: number;
  active_clients: number;
  churn_monthly: number;
  retainer: number;
  /** Minimum share of a person's week left for pipeline work (default 0.08). */
  availability_floor?: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  settings: WorkspaceSettings;
}

export interface RoleRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  default_cost_rate: number;
  headcount: number;
  ongoing_hours_per_client_week: number;
}

export interface PersonRow {
  id: string;
  workspace_id: string;
  name: string;
  fte: number;
  capacity_hours_week: number | null;
  cost_rate: number | null;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
}

export interface PersonRoleRow {
  person_id: string;
  role_id: string;
  workspace_id: string;
}

export interface PersonSkillRow {
  person_id: string;
  step_id: string;
  workspace_id: string;
}

export interface PersonLeaveRow {
  id: string;
  person_id: string;
  workspace_id: string;
  /** ISO date, inclusive. */
  start_date: string;
  /** ISO date, inclusive. */
  end_date: string;
}

export interface ProcessRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: "pipeline" | "servicing";
  entity_name: string;
  description: string | null;
  live_revision_id: string | null;
}

export interface ProcessRevisionRow {
  id: string;
  workspace_id: string;
  process_id: string;
  number: number;
  status: "draft" | "published" | "superseded";
}

export interface StepRow {
  id: string;
  revision_id: string;
  workspace_id: string;
  process_id: string;
  name: string;
  kind: StepKind;
  outcome: StepOutcome | null;
  role_id: string | null;
  person_id: string | null;
  work_hours: number;
  work_dist: Distribution;
  work_params: DistParams;
  wait_hours: number;
  wait_dist: Distribution;
  wait_params: DistParams;
  rework_rate: number;
  /** Step a rework goes back to; null means the same step. Not simulated yet. */
  rework_to_step_id: string | null;
  tool: string | null;
  notes: string | null;
  /** Target hours for one visit to the step (queue + hands-on + wait); visits over it are SLA breaches. */
  sla_hours: number | null;
  /** Items sitting at this step now; null when not entered (docs/PRD.md §6.3.1). */
  current_wip: number | null;
  x: number;
  y: number;
  /**
   * The step's values are estimates nobody has confirmed yet (e.g. filled in
   * by the MCP server). Publishing a draft with any is refused unless they are
   * accepted as estimates (docs/PRD.md §7.1b).
   */
  assumption: boolean;
  /**
   * Steps that took over this one's work when it was split or replaced in the
   * editor (docs/PRD.md §4.1 "Stable step IDs"). A step with any is retired:
   * its row stays in the revision so saved scenarios aimed at it can be
   * re-pointed (issue #16), but it is never drawn or simulated; loaders put
   * it in `ProcessBundle.retired`, not `steps`. Absent or empty on live steps.
   */
  replaced_by?: string[];
}

export interface EdgeRow {
  id: string;
  revision_id: string;
  workspace_id: string;
  process_id: string;
  from_step_id: string;
  to_step_id: string;
  probability: number;
  condition_tag: string | null;
  label: string | null;
}

/**
 * Something the business sells (docs/PRD.md §5). Each arrival at a process is
 * tagged with one of the active services entering it, drawn from the mix, and
 * is priced and routed by it (§6.4 revenue rules, decision D8).
 */
export interface ServiceRow {
  id: string;
  workspace_id: string;
  name: string;
  pricing_model: PricingModel;
  /** Monthly fee (retainer), whole fee (one-off) or hourly rate. */
  price: number;
  /** Gross margin as a share of price (0–1). */
  margin: number;
  /** Expected tenure of a retainer client, in months. */
  tenure_months: number;
  /** Base monthly churn (0–1). */
  churn_monthly_base: number;
  /** Relative share of arrivals. */
  mix_share: number;
  /** Process its arrivals enter; null means the workspace's pipeline (whichever process is simulated). */
  entry_process_id: string | null;
  /** Condition tags its entities follow (`edges.condition_tag`). */
  path_tags: string[];
  /** Inactive services are left out of simulations. */
  active: boolean;
}

/** Where a parameter's value came from (docs/PRD.md §3 Parameter provenance). */
export type ProvenanceSource = "estimated" | "entered" | "measured";

/**
 * One value's provenance (the §5 `provenance jsonb` shape). A type alias, not
 * an interface, so it stays assignable to the jsonb column.
 */
export type Provenance = {
  source: ProvenanceSource;
  /** When it was set (ISO timestamp). */
  at?: string;
  /** User who set it. */
  by?: string;
  /** Dataset a measured value came from. */
  dataset_id?: string;
  note?: string;
};

/**
 * Provenance per value column, as stored in a row's `provenance` jsonb
 * (e.g. `{volume_week: {...}, conversion_to_qualified: {...}}`). The
 * database stamps `entered` when a person changes a value; a value with no
 * entry is an estimate.
 */
export type ProvenanceMap = { [column: string]: Provenance | undefined };

/** Where qualified leads come from (docs/PRD.md §5 `lead_sources`). */
export interface LeadSourceRow {
  id: string;
  workspace_id: string;
  name: string;
  /** Leads a week. */
  volume_week: number;
  /** Share that become qualified leads (0–1). */
  conversion_to_qualified: number;
  provenance: ProvenanceMap;
}

/** One month of the seasonality curve. A month with no row has a multiplier of 1. */
export interface SeasonalityRow {
  id: string;
  workspace_id: string;
  /** 1 = January. */
  month: number;
  multiplier: number;
  provenance: ProvenanceMap;
}

/** The workspace's growth assumption; no row means no growth. */
export interface DemandSettingsRow {
  workspace_id: string;
  /** Compound change in the arrival rate per month (0.02 is +2%). */
  growth_monthly: number;
  provenance: ProvenanceMap;
}

/** Everything needed to render and simulate one process revision. */
export interface ProcessBundle {
  workspace: WorkspaceRow;
  roles: RoleRow[];
  process: ProcessRow;
  revision: ProcessRevisionRow;
  steps: StepRow[];
  edges: EdgeRow[];
  /**
   * Steps of this revision that were split or replaced (they have
   * `replaced_by`). Kept apart from `steps` so nothing draws or simulates
   * them; read to re-point scenarios that still target them (issue #16).
   */
  retired?: StepRow[];
  /** Named people. When empty, roles' head-counts are used instead. */
  people: PersonRow[];
  personRoles: PersonRoleRow[];
  personSkills: PersonSkillRow[];
  personLeave: PersonLeaveRow[];
  /** The workspace's services. When none apply, every win is priced at the workspace's interim `retainer`. */
  services: ServiceRow[];
  /**
   * The workspace's demand model (issue #13). With no lead sources, the
   * interim `settings.leads_per_week` is the arrival rate; with no
   * seasonality rows or demand settings, it is constant.
   */
  leadSources?: LeadSourceRow[];
  seasonality?: SeasonalityRow[];
  demand?: DemandSettingsRow | null;
}

/**
 * A saved scenario: patches applied in order on top of the baseline model
 * (docs/PRD.md §5; the grammar is in packages/engine/src/scenario.ts).
 */
export interface ScenarioRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  patch: ScenarioPatch[];
  parent_scenario_id: string | null;
}

export type IssueStatus = "open" | "in_progress" | "done" | "dismissed";
/** Logged by hand, detected by a stored run (reserved), or promoted from a detection. */
export type IssueSource = "manual" | "detected" | "promoted";

/**
 * A tracked issue in the register (docs/PRD.md §5 `issues`). Detected issues
 * aren't stored: they come from each run (engine `detectIssues`); promoting
 * one stores it with its `detected_key`.
 */
export interface IssueRow {
  id: string;
  workspace_id: string;
  process_id: string | null;
  /** A step's stable id (no foreign key: steps are keyed by revision). */
  step_id: string | null;
  role_id: string | null;
  person_id: string | null;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  evidence: string | null;
  /** Numbers behind the finding, e.g. a promoted detection's metrics. */
  evidence_metrics: Record<string, number>;
  owner_person_id: string | null;
  status: IssueStatus;
  /** The saved scenario "Run the fix" applies. */
  scenario_id: string | null;
  source: IssueSource;
  detected_key: string | null;
  /** Set by the database when the status becomes done or dismissed. */
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** An allowed email domain: managed Google accounts on it join as `member`. */
export interface WorkspaceDomainRow {
  id: string;
  workspace_id: string;
  domain: string;
}

/** A pre-assigned email: whoever signs in with it gets exactly this role. */
export interface AccessEmailRow {
  id: string;
  workspace_id: string;
  email: string;
  role: Exclude<MembershipRole, "agency_admin">;
  person_id: string | null;
}

/** Who can get into a workspace without an invitation (issue #51). */
export interface WorkspaceAccess {
  domains: WorkspaceDomainRow[];
  emails: AccessEmailRow[];
}

type TableRow<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

/** `true` when every field of `Row` is a column of table `T` with a compatible type. */
type Matches<Row, T extends keyof Database["public"]["Tables"]> = [Exclude<keyof Row, keyof TableRow<T>>] extends [never]
  ? Row extends Pick<TableRow<T>, keyof Row & keyof TableRow<T>>
    ? true
    : { mismatch: T }
  : { unknownColumns: Exclude<keyof Row, keyof TableRow<T>> };
type Assert<T extends true> = T;

export type _SchemaDriftChecks = [
  // settings is jsonb; WorkspaceSettings is its app-side shape.
  Assert<Matches<Omit<WorkspaceRow, "settings">, "workspaces">>,
  Assert<Matches<RoleRow, "roles">>,
  Assert<Matches<PersonRow, "people">>,
  Assert<Matches<PersonRoleRow, "person_roles">>,
  Assert<Matches<PersonSkillRow, "person_skills">>,
  Assert<Matches<PersonLeaveRow, "person_leave">>,
  Assert<Matches<ProcessRow, "processes">>,
  Assert<Matches<ProcessRevisionRow, "process_revisions">>,
  // replaced_by defaults to '{}' in the table; the app leaves it out of new steps.
  Assert<Matches<Omit<StepRow, "replaced_by">, "steps">>,
  Assert<Matches<EdgeRow, "edges">>,
  Assert<Matches<ServiceRow, "services">>,
  Assert<Matches<LeadSourceRow, "lead_sources">>,
  Assert<Matches<SeasonalityRow, "seasonality">>,
  Assert<Matches<DemandSettingsRow, "demand_settings">>,
  Assert<Matches<WorkspaceDomainRow, "workspace_domains">>,
  Assert<Matches<AccessEmailRow, "workspace_access_emails">>,
  // patch is jsonb; ScenarioPatch[] is its checked shape.
  Assert<Matches<Omit<ScenarioRow, "patch">, "scenarios">>,
  // evidence_metrics is jsonb; Record<string, number> is its app-side shape.
  Assert<Matches<Omit<IssueRow, "evidence_metrics">, "issues">>,
];
