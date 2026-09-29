// Row shapes the app and engine work with. The database shape itself lives in
// `database.types.ts` (generated: `pnpm --filter @transpera-flow/db gen:types`); these
// narrow its check-constrained text and jsonb columns, and the checks at the
// bottom fail the typecheck if they drift from it.

import type { Database } from "./database.types";

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
  /** Items sitting at this step now; null when not entered (docs/PRD.md §6.3.1). */
  current_wip: number | null;
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
  Assert<Matches<StepRow, "steps">>,
  Assert<Matches<EdgeRow, "edges">>,
  Assert<Matches<WorkspaceDomainRow, "workspace_domains">>,
  Assert<Matches<AccessEmailRow, "workspace_access_emails">>,
];
