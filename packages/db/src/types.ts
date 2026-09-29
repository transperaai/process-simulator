// Row shapes for the tables in the walking-skeleton migration. Hand-written for
// now; replace with `supabase gen types typescript` output once a Supabase
// project is connected (see docs/supabase-notes.md).

export type MembershipRole = "agency_admin" | "owner" | "editor" | "member" | "viewer";
export type StepKind = "task" | "wait" | "decision" | "subprocess" | "start" | "end";
export type StepOutcome = "won" | "lost" | "done";
export type Distribution = "constant" | "triangular" | "lognormal";

export interface WorkspaceSettings {
  hours_per_week: number;
  horizon_weeks: number;
  currency: string;
  /** Interim demand fields until lead sources, services and clients land. */
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
  wait_hours: number;
  wait_dist: Distribution;
  rework_rate: number;
  tool: string | null;
  x: number;
  y: number;
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

/** Everything needed to render and simulate one process revision. */
export interface ProcessBundle {
  workspace: WorkspaceRow;
  roles: RoleRow[];
  process: ProcessRow;
  revision: ProcessRevisionRow;
  steps: StepRow[];
  edges: EdgeRow[];
  /** Named people. When empty, roles' head-counts are used instead. */
  people: PersonRow[];
  personRoles: PersonRoleRow[];
  personSkills: PersonSkillRow[];
  personLeave: PersonLeaveRow[];
}
