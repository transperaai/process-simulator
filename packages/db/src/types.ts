// Row shapes the app and engine work with. The database shape itself lives in
// `database.types.ts` (generated: `pnpm --filter @transpera-flow/db gen:types`); these
// narrow its check-constrained text and jsonb columns, and the checks at the
// bottom fail the typecheck if they drift from it.

import type { IssueType, ScenarioPatch, StoredSeverity } from "@transpera-flow/engine";
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
  /**
   * Overtime someone may work when their client work exceeds their week, as a
   * share of their capacity (default 0: none; docs/PRD.md §6.3.4, decision D7).
   */
  overtime_cap?: number;
  /**
   * How servicing moves client health (docs/PRD.md §6.3.5; issue #19):
   * health added for a task done on time, taken off for a late one and for a
   * missed one, and the health of a client with none entered. Left out: the
   * estimated defaults (2, 5, 12, 80).
   */
  health_recover?: number;
  health_late_penalty?: number;
  health_missed_penalty?: number;
  health_initial?: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  settings: WorkspaceSettings;
  /** Provenance of the settings, keyed `settings.<key>` (issue #25); loaded only where shown. */
  provenance?: ProvenanceMap;
}

export interface RoleRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  default_cost_rate: number;
  headcount: number;
  ongoing_hours_per_client_week: number;
  /** Inactive roles are hidden from pickers; what already names one keeps it, and it still simulates. */
  active: boolean;
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
  /** Provenance of fte, capacity, cost rate and dates (issue #25); loaded only where shown. */
  provenance?: ProvenanceMap;
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
   * Sources disagree on one of the step's values and nobody has settled it
   * yet (docs/PRD.md §4.1 Sources and evidence, D17). Kept in step with the
   * per-column `provenance.<column>.conflict` entries (see evidence.ts).
   */
  conflict: boolean;
  /** Where each value came from, per column (`{work_hours: {source, at, by, evidence, conflict}}`). */
  provenance: ProvenanceMap;
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
  /** Base monthly churn (0–1): at full health, the churn of a client on this service. */
  churn_monthly_base: number;
  /**
   * How much poor health raises churn (docs/PRD.md §6.3.5): monthly churn =
   * base × (1 + sensitivity × (100 − health) / 100). Default 3, an estimate.
   */
  churn_health_sensitivity: number;
  /** Relative share of arrivals. */
  mix_share: number;
  /** Process its arrivals enter; null means the workspace's pipeline (whichever process is simulated). */
  entry_process_id: string | null;
  /** Condition tags its entities follow (`edges.condition_tag`). */
  path_tags: string[];
  /**
   * Hours a month each client on this service needs from each role (role id →
   * hours), while no servicing process is mapped (docs/PRD.md §6.3.4). Empty:
   * the roles' `ongoing_hours_per_client_week` apply.
   */
  fallback_ongoing_load: FallbackLoad;
  /** Inactive services are left out of simulations. */
  active: boolean;
  /** Provenance of the pricing and churn values (issue #25); loaded only where shown. */
  provenance?: ProvenanceMap;
}

/** Role id → hours a month per client. A type alias, so it stays assignable to the jsonb column. */
export type FallbackLoad = { [roleId: string]: number };

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
  /** Why the value is what it is (e.g. Claude's reasoning for an assumption). */
  note?: string;
  /** Filled in without a source (a default or an inference); listed for confirmation until someone confirms it. */
  assumption?: boolean;
  /** What people said about the value (docs/PRD.md §7.2). */
  evidence?: EvidenceCitation[];
  /** Sources disagree on the value: what each said, and whether someone has settled it. */
  conflict?: ProvenanceConflict;
  /** The accepted suggestion the value came from (issue #25). */
  suggestion_id?: string;
};

/**
 * One citation of a source for a value (docs/PRD.md §5 `provenance.evidence`):
 * who said it, their words and where in the recording. `value` is the number
 * they stated, in the column's units (hours, a 0–1 share, items), when they
 * stated one; citations that state different values make a conflict.
 */
export type EvidenceCitation = {
  source_id: string;
  speaker?: string | null;
  quote: string;
  /** Where in the source: a time in the recording ("00:12:40"), a page, or a date. */
  timestamp?: string | null;
  value?: number | null;
};

/** One of the disagreeing values (docs/PRD.md §5 `provenance.conflict.values`). */
export type ConflictValue = { value: number; source_id: string | null; speaker: string | null };

/**
 * A disagreement between sources. The value becomes a triangular range over
 * `values` until someone settles it; `resolved` records who did and how.
 */
export type ProvenanceConflict = {
  values: ConflictValue[];
  resolved?: { at: string; by?: string; choice: "range" | "value" };
};

/**
 * Provenance per value column, as stored in a row's `provenance` jsonb
 * (e.g. `{volume_week: {...}, conversion_to_qualified: {...}}`). The
 * database stamps `entered` when a person changes a value; a value with no
 * entry is an estimate.
 */
export type ProvenanceMap = { [column: string]: Provenance | undefined };

/**
 * A client on the roster (docs/PRD.md §5 `clients`, decision D13). Real
 * clients seed the simulation; per-person client counts come from
 * `client_assignments`.
 */
export interface ClientRow {
  id: string;
  workspace_id: string;
  name: string;
  /** ISO date they became a client; null if not known. */
  start_date: string | null;
  /** Monthly recurring revenue. */
  mrr: number;
  /** 0–100; null: not entered (simulated from the estimated 80). */
  health: number | null;
  /** Provenance of `mrr` and `health`. */
  provenance: ProvenanceMap;
  notes: string | null;
  /** Inactive clients (they left) are kept on record but not simulated. */
  active: boolean;
}

/** A service a client takes. */
export interface ClientServiceRow {
  client_id: string;
  service_id: string;
  workspace_id: string;
  /** When they started on it; null: with the client. */
  start_date: string | null;
}

/** The person looking after a client for a role. No row: the role's people share it. */
export interface ClientAssignmentRow {
  client_id: string;
  role_id: string;
  person_id: string;
  workspace_id: string;
}

export type SourceKind = "transcript" | "notes" | "screenshot";

/**
 * A transcript, note set or screenshot from the audit (docs/PRD.md §3 Source,
 * §5 `sources`). Parameters cite it by id in `provenance.<column>.evidence`.
 */
export interface SourceRow {
  id: string;
  workspace_id: string;
  kind: SourceKind;
  title: string;
  speakers: string[];
  /** ISO date the conversation or notes are from. */
  recorded_at: string | null;
  /** The transcript or notes text. */
  body: string | null;
  /** Link to the file (a screenshot, the recording), if it lives elsewhere. */
  file_url: string | null;
  created_at: string;
  updated_at: string;
}

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

/**
 * How often a client generates a servicing task (docs/PRD.md §5
 * `service_servicing.recurrence`): `times` tasks spread evenly over every
 * week or month, or ad-hoc requests at random, `poisson_per_month` a month on
 * average. A type alias, so it stays assignable to the jsonb column.
 */
export type RecurrenceJson = { every: "week" | "month"; times: number } | { poisson_per_month: number };

/**
 * A servicing process a service's clients run, and how often (docs/PRD.md
 * §5 `service_servicing`, §6.3.5; issue #19).
 */
export interface ServiceServicingRow {
  id: string;
  workspace_id: string;
  service_id: string;
  /** A process of kind `servicing`. */
  process_id: string;
  recurrence: RecurrenceJson;
  /** On time within this many working hours of the task starting; missed beyond twice it. */
  sla_hours: number;
  /** Provenance of `recurrence` and `sla_hours`. */
  provenance: ProvenanceMap;
}

/** One process at one revision: what a run needs of a process other than the one on screen. */
export interface ProcessPart {
  process: ProcessRow;
  revision: ProcessRevisionRow;
  steps: StepRow[];
  edges: EdgeRow[];
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
  /**
   * The client roster (issue #18). With any clients, ongoing load is per
   * client and assigned person; with none (or omitted), the interim
   * `settings.active_clients` × the roles' hours per client, as before.
   */
  clients?: ClientRow[];
  clientServices?: ClientServiceRow[];
  clientAssignments?: ClientAssignmentRow[];
  /**
   * Client servicing (issue #19): which servicing processes each service's
   * clients run, and the workspace's other processes at their live
   * revisions, which a run of this one needs: its servicing processes, and,
   * when this bundle is itself a servicing process, the pipeline it runs
   * beside. Omitted or empty: no servicing, as before it existed.
   */
  servicingLinks?: ServiceServicingRow[];
  otherProcesses?: ProcessPart[];
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
  /** The client it is about (issue #18). */
  client_id: string | null;
  type: IssueType;
  /** The stored value of the issue's rating (great = info, good = warning, bad = serious, risk = critical; see `ratingOfStored`). */
  severity: StoredSeverity;
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

/** The company-model tables a suggestion can change (docs/PRD.md §7.1c). */
export type SuggestionTarget = "workspaces" | "services" | "people" | "clients" | "lead_sources" | "seasonality" | "demand_settings" | "roles";
export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type SuggestionValue = string | number | boolean | null;

/**
 * What a suggestion changes (issue #25). `set` holds column values (for
 * `workspaces`, settings keys). People take `roles` (the full set, by id) and
 * `leave` (periods to add); clients take `services` (the full set, by id) and
 * `assignments` (role id → person id, or null to clear). A type alias, so it
 * stays assignable to the jsonb column.
 */
export type SuggestionPatch = {
  set: { [column: string]: SuggestionValue };
  roles?: string[];
  services?: string[];
  assignments?: { [roleId: string]: string | null };
  leave?: { start_date: string; end_date: string; note?: string | null }[];
};

/** What accepting a suggestion changed: the row, and its values before and after. */
export type SuggestionApplied = {
  target_id: string;
  /** Null when the suggestion created the row. */
  before: { [field: string]: unknown } | null;
  after: { [field: string]: unknown };
};

/**
 * A proposed change to the company model from the MCP server, awaiting a
 * person's accept or reject (docs/PRD.md §3 Suggestion, §5 `suggestions`).
 */
export interface SuggestionRow {
  id: string;
  workspace_id: string;
  target_table: SuggestionTarget;
  /** The row it changes; null: a new row (workspaces and demand_settings: the workspace's own). */
  target_id: string | null;
  patch: SuggestionPatch;
  evidence: EvidenceCitation[];
  /** The suggester's reasoning. */
  note: string | null;
  status: SuggestionStatus;
  created_via: "mcp";
  applied: SuggestionApplied | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  created_by: string | null;
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
  // provenance is loaded only where shown (optional here, required in the table).
  Assert<Matches<Omit<WorkspaceRow, "settings" | "provenance">, "workspaces">>,
  Assert<Matches<RoleRow, "roles">>,
  Assert<Matches<Omit<PersonRow, "provenance">, "people">>,
  Assert<Matches<PersonRoleRow, "person_roles">>,
  Assert<Matches<PersonSkillRow, "person_skills">>,
  Assert<Matches<PersonLeaveRow, "person_leave">>,
  Assert<Matches<ProcessRow, "processes">>,
  Assert<Matches<ProcessRevisionRow, "process_revisions">>,
  // replaced_by defaults to '{}' in the table; the app leaves it out of new steps.
  Assert<Matches<Omit<StepRow, "replaced_by">, "steps">>,
  Assert<Matches<EdgeRow, "edges">>,
  // fallback_ongoing_load is jsonb; FallbackLoad is its app-side shape.
  Assert<Matches<Omit<ServiceRow, "provenance">, "services">>,
  // provenance is jsonb; ProvenanceMap is its app-side shape.
  Assert<Matches<ClientRow, "clients">>,
  Assert<Matches<ClientServiceRow, "client_services">>,
  Assert<Matches<ClientAssignmentRow, "client_assignments">>,
  // recurrence and provenance are jsonb; RecurrenceJson and ProvenanceMap are their app-side shapes.
  Assert<Matches<Omit<ServiceServicingRow, "recurrence">, "service_servicing">>,
  Assert<Matches<LeadSourceRow, "lead_sources">>,
  Assert<Matches<SeasonalityRow, "seasonality">>,
  Assert<Matches<DemandSettingsRow, "demand_settings">>,
  Assert<Matches<WorkspaceDomainRow, "workspace_domains">>,
  Assert<Matches<AccessEmailRow, "workspace_access_emails">>,
  // patch is jsonb; ScenarioPatch[] is its checked shape.
  Assert<Matches<Omit<ScenarioRow, "patch">, "scenarios">>,
  // evidence_metrics is jsonb; Record<string, number> is its app-side shape.
  Assert<Matches<Omit<IssueRow, "evidence_metrics">, "issues">>,
  Assert<Matches<SourceRow, "sources">>,
  // patch, evidence and applied are jsonb; the check constraints limit the text columns.
  Assert<Matches<Omit<SuggestionRow, "patch" | "evidence" | "applied">, "suggestions">>,
];
