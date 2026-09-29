import "server-only";
import {
  DEMAND_SETTINGS_COLUMNS,
  LEAD_SOURCE_COLUMNS,
  loadLiveProcessBySlug,
  SEASONALITY_COLUMNS,
  SERVICE_COLUMNS,
  type DemandSettingsRow,
  type LeadSourceRow,
  type PersonLeaveRow,
  type PersonRoleRow,
  type PersonRow,
  type PersonSkillRow,
  type ProcessBundle,
  type RoleRow,
  type SeasonalityRow,
  type ServiceRow,
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
  services: ServiceRow[];
  /** The workspace's processes, for a service's entry process. */
  processes: { id: string; name: string; kind: string }[];
  /** Condition tags on the connections of the live processes, as hints for services' path tags. */
  conditionTags: string[];
  /** Demand (issue #13): lead sources oldest first, seasonality by month, and the growth row if any. */
  leadSources: LeadSourceRow[];
  seasonality: SeasonalityRow[];
  demand: DemandSettingsRow | null;
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
    .select("id, name, kind, live_revision_id")
    .eq("workspace_id", ws)
    .order("created_at")
    .order("id");
  if (pError) throw pError;
  const revisions = processes.flatMap((p) => (p.live_revision_id ? [p.live_revision_id] : []));

  const demandQueries = Promise.all([
    supabase.from("lead_sources").select(LEAD_SOURCE_COLUMNS).eq("workspace_id", ws).order("created_at").order("id"),
    supabase.from("seasonality").select(SEASONALITY_COLUMNS).eq("workspace_id", ws).order("month"),
    supabase.from("demand_settings").select(DEMAND_SETTINGS_COLUMNS).eq("workspace_id", ws).maybeSingle(),
  ]);
  const [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave, services, tags] = await Promise.all([
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
    supabase.from("services").select(SERVICE_COLUMNS).eq("workspace_id", ws).order("created_at").order("id"),
    supabase.from("edges").select("condition_tag").in("revision_id", revisions).not("condition_tag", "is", null),
  ]);
  const [leadSources, seasonality, demand] = await demandQueries;
  for (const r of [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave, services, tags, leadSources, seasonality, demand]) {
    if (r.error) throw r.error;
  }

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
    // The cast narrows pricing_model, which a check constraint limits.
    services: (services.data ?? []) as ServiceRow[],
    processes: processes.map(({ id, name, kind }) => ({ id, name, kind })),
    conditionTags: [...new Set((tags.data ?? []).map((e) => e.condition_tag?.trim() ?? "").filter(Boolean))].sort(),
    // The casts give the provenance jsonb its shape.
    leadSources: (leadSources.data ?? []) as LeadSourceRow[],
    seasonality: (seasonality.data ?? []) as SeasonalityRow[],
    demand: demand.data as DemandSettingsRow | null,
  };
}
