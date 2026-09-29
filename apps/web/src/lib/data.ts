import "server-only";
import {
  listProcesses,
  loadIssues,
  loadLiveProcessBySlug,
  loadScenarios,
  type IssueRow,
  type PersonLeaveRow,
  type PersonRoleRow,
  type PersonRow,
  type PersonSkillRow,
  type ProcessBundle,
  type RoleRow,
  type ScenarioRow,
  type StepRow,
  type WorkspaceRow,
  type WorkspaceSettings,
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
  return loadLiveProcessBySlug(await createClient(), slug);
}

/** The workspace's tracked issues, newest first (RLS: everyone in the workspace can read them). */
export async function loadWorkspaceIssues(workspaceId: string): Promise<IssueRow[]> {
  return loadIssues(await createClient(), workspaceId);
}

/** The workspace's processes, by id and name, for the register's process filter. */
export async function loadProcessNames(workspaceId: string): Promise<{ id: string; name: string }[]> {
  return (await listProcesses(await createClient(), workspaceId)).map((p) => ({ id: p.id, name: p.name }));
}

/** The workspace's saved scenarios, oldest first (RLS: everyone in the workspace can read them). */
export async function loadWorkspaceScenarios(workspaceId: string): Promise<ScenarioRow[]> {
  return loadScenarios(await createClient(), workspaceId);
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
