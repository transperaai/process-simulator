import "server-only";
import type {
  PersonLeaveRow,
  PersonRoleRow,
  PersonRow,
  PersonSkillRow,
  ProcessBundle,
  ProcessRevisionRow,
  ProcessRow,
  RoleRow,
  StepRow,
  WorkspaceRow,
  WorkspaceSettings,
} from "@transpera-flow/db";
import { createClient } from "./supabase/server";

/** Workspaces the signed-in user can see (RLS decides). */
export async function listWorkspaces(): Promise<Pick<WorkspaceRow, "id" | "name" | "slug">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").select("id, name, slug").order("name");
  if (error) throw error;
  return data;
}

/** The workspace's first process at its live revision, or null if not visible. */
export async function loadLiveProcess(slug: string): Promise<ProcessBundle | null> {
  const supabase = await createClient();
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name, slug, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (wsError) throw wsError;
  if (!workspace) return null;

  const { data: process, error: pError } = await supabase
    .from("processes")
    .select("id, workspace_id, name, kind, entity_name, description, live_revision_id")
    .eq("workspace_id", workspace.id)
    .not("live_revision_id", "is", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (pError) throw pError;
  if (!process) return null;

  const rev = process.live_revision_id as string;
  const ws = workspace.id;
  const [revision, roles, steps, edges, people, personRoles, personSkills, personLeave] = await Promise.all([
    supabase.from("process_revisions").select("id, workspace_id, process_id, number, status").eq("id", rev).single(),
    supabase.from("roles").select("*").eq("workspace_id", ws),
    supabase.from("steps").select("*").eq("revision_id", rev),
    supabase.from("edges").select("*").eq("revision_id", rev),
    supabase.from("people").select("id, workspace_id, name, fte, capacity_hours_week, cost_rate, active, start_date, end_date").eq("workspace_id", ws),
    supabase.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
    supabase.from("person_skills").select("person_id, step_id, workspace_id").eq("workspace_id", ws),
    supabase.from("person_leave").select("id, person_id, workspace_id, start_date, end_date").eq("workspace_id", ws),
  ]);
  for (const r of [revision, roles, steps, edges, people, personRoles, personSkills, personLeave]) if (r.error) throw r.error;

  // The casts narrow text columns that check constraints already limit, and the settings jsonb.
  return {
    workspace: { ...workspace, settings: workspace.settings as unknown as WorkspaceSettings },
    process: process as ProcessRow,
    revision: revision.data as ProcessRevisionRow,
    roles: roles.data ?? [],
    steps: (steps.data ?? []) as StepRow[],
    edges: edges.data ?? [],
    people: people.data ?? [],
    personRoles: personRoles.data ?? [],
    personSkills: personSkills.data ?? [],
    personLeave: personLeave.data ?? [],
  };
}

export interface PersonDetail extends PersonRow {
  email: string | null;
  notes: string | null;
}

export interface LeaveDetail extends PersonLeaveRow {
  note: string | null;
}

/** Everything the workspace settings page edits, and what the user may change. */
export interface WorkspaceSettingsData {
  workspace: WorkspaceRow;
  /** agency_admin, owner or editor: may manage people. */
  canEdit: boolean;
  /** agency_admin or owner: may change workspace settings. */
  canManage: boolean;
  roles: Pick<RoleRow, "id" | "name" | "color">[];
  /** Steps someone does (working steps with a role) in the workspace's live processes, for skills. */
  steps: Pick<StepRow, "id" | "name" | "role_id">[];
  people: PersonDetail[];
  personRoles: PersonRoleRow[];
  personSkills: PersonSkillRow[];
  personLeave: LeaveDetail[];
}

export async function loadWorkspaceSettings(slug: string): Promise<WorkspaceSettingsData | null> {
  const supabase = await createClient();
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name, slug, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (wsError) throw wsError;
  if (!workspace) return null;
  const ws = workspace.id;

  const { data: processes, error: pError } = await supabase
    .from("processes")
    .select("live_revision_id")
    .eq("workspace_id", ws)
    .not("live_revision_id", "is", null);
  if (pError) throw pError;
  const revisions = processes.map((p) => p.live_revision_id as string);

  const [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave] = await Promise.all([
    supabase.rpc("can_edit_workspace", { ws }),
    supabase.rpc("can_manage_workspace", { ws }),
    supabase.from("roles").select("id, name, color").eq("workspace_id", ws).order("name"),
    supabase
      .from("steps")
      .select("id, name, role_id")
      .in("revision_id", revisions)
      .not("kind", "in", "(start,end)")
      .not("role_id", "is", null)
      .order("y")
      .order("x"),
    supabase
      .from("people")
      .select("id, workspace_id, name, email, fte, capacity_hours_week, cost_rate, active, start_date, end_date, notes")
      .eq("workspace_id", ws)
      .order("name"),
    supabase.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
    supabase.from("person_skills").select("person_id, step_id, workspace_id").eq("workspace_id", ws),
    supabase
      .from("person_leave")
      .select("id, person_id, workspace_id, start_date, end_date, note")
      .eq("workspace_id", ws)
      .order("start_date"),
  ]);
  for (const r of [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave]) if (r.error) throw r.error;

  return {
    workspace: { ...workspace, settings: workspace.settings as unknown as WorkspaceSettings },
    canEdit: canEdit.data === true,
    canManage: canManage.data === true,
    roles: roles.data ?? [],
    steps: steps.data ?? [],
    people: people.data ?? [],
    personRoles: personRoles.data ?? [],
    personSkills: personSkills.data ?? [],
    personLeave: personLeave.data ?? [],
  };
}
