import "server-only";
import {
  DEMAND_SETTINGS_COLUMNS,
  LEAD_SOURCE_COLUMNS,
  listProcesses,
  loadClients,
  loadIssues,
  loadLiveProcessBySlug,
  loadProcessBySlug,
  loadScenarios,
  loadSources,
  loadCitingRows,
  citationsBySource,
  type SourceCitation,
  type SourceRow,
  SEASONALITY_COLUMNS,
  SERVICE_COLUMNS,
  SERVICE_SERVICING_COLUMNS,
  type ServiceServicingRow,
  type DemandSettingsRow,
  type IssueRow,
  type LeadSourceRow,
  type PersonLeaveRow,
  type PersonRoleRow,
  type PersonRow,
  type PersonSkillRow,
  type ProcessBundle,
  type ProcessListing,
  type RoleRow,
  type ScenarioRow,
  type SeasonalityRow,
  type ServiceRow,
  type StepRow,
  type WorkspaceRow,
  type WorkspaceSettings,
} from "@transpera-flow/db";
import type { RosterData } from "./clients/roster";
import { roleUsage, type RoleUsage } from "./roles";
import { createClient } from "./supabase/server";

/** Workspaces the signed-in user can see (RLS decides). */
export async function listWorkspaces(): Promise<Pick<WorkspaceRow, "id" | "name" | "slug">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").select("id, name, slug").order("name");
  if (error) throw error;
  return data;
}

/** The workspace's sources (RLS: everyone in the workspace can read them). */
export async function loadWorkspaceSources(workspaceId: string): Promise<SourceRow[]> {
  return loadSources(await createClient(), workspaceId);
}

/** The Sources page: the workspace, its sources, and every value citing each one (issue #21). */
export async function loadSourcesPage(
  slug: string,
): Promise<{ workspace: Pick<WorkspaceRow, "id" | "name" | "slug">; sources: SourceRow[]; citations: Record<string, SourceCitation[]> } | null> {
  const supabase = await createClient();
  const { data: workspace, error } = await supabase.from("workspaces").select("id, name, slug").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!workspace) return null;
  const [sources, rows] = await Promise.all([loadSources(supabase, workspace.id), loadCitingRows(supabase, workspace.id)]);
  return { workspace, sources, citations: Object.fromEntries(citationsBySource(rows)) };
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

/**
 * A process of the workspace for the editor: its live revision (an empty
 * stand-in if never published), its open draft if any (issue #9), and the
 * workspace's processes for the picker (issue #76). Without `processId`, the
 * first process with a live revision.
 */
export async function loadProcessForEditing(
  slug: string,
  processId?: string,
): Promise<{ live: ProcessBundle; draft: ProcessBundle | null; processes: ProcessListing[] } | null> {
  return loadProcessBySlug(await createClient(), slug, processId ? { processId } : {});
}

/**
 * A workspace with no published process (a new one): its name and whatever
 * processes exist, for the page that stands in for the canvas (issue #88).
 */
export async function loadWorkspaceOverview(
  slug: string,
): Promise<{ workspace: Pick<WorkspaceRow, "id" | "name" | "slug">; processes: ProcessListing[] } | null> {
  const supabase = await createClient();
  const { data: workspace, error } = await supabase.from("workspaces").select("id, name, slug").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!workspace) return null;
  const processes = await listProcesses(supabase, workspace.id);
  return {
    workspace,
    processes: processes.map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: p.live_revision_id !== null, draft: p.draft_revision_id !== null })),
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
  roles: Pick<RoleRow, "id" | "name" | "color" | "active">[];
  /** How many steps (any revision), people, clients and services name each role, by role id. */
  roleUsage: Record<string, RoleUsage>;
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
  /** Which servicing processes each service's clients run (issue #19). */
  servicingLinks: ServiceServicingRow[];
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
    supabase.from("service_servicing").select(SERVICE_SERVICING_COLUMNS).eq("workspace_id", ws).order("created_at").order("id"),
  ]);
  const [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave, services, tags, roleSteps, assignments] = await Promise.all([
    supabase.rpc("can_edit_workspace", { ws }),
    supabase.rpc("can_manage_workspace", { ws }),
    supabase.from("roles").select("id, name, color, active").eq("workspace_id", ws).order("name"),
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
    // Every revision, live or not: a role a superseded step names can't be deleted either.
    supabase.from("steps").select("id, role_id").eq("workspace_id", ws).not("role_id", "is", null),
    supabase.from("client_assignments").select("client_id, role_id").eq("workspace_id", ws),
  ]);
  const [leadSources, seasonality, demand, servicingLinks] = await demandQueries;
  for (const r of [canEdit, canManage, roles, steps, people, personRoles, personSkills, personLeave, services, tags, roleSteps, assignments, leadSources, seasonality, demand, servicingLinks]) {
    if (r.error) throw r.error;
  }

  return {
    workspace: { ...workspace, settings: workspace.settings as unknown as WorkspaceSettings },
    canEdit: canEdit.data === true,
    canManage: canManage.data === true,
    roles: roles.data ?? [],
    roleUsage: roleUsage(roleSteps.data ?? [], personRoles.data ?? [], assignments.data ?? [], (services.data ?? []) as ServiceRow[]),
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
    // recurrence and provenance are jsonb; the table's check limits recurrence to RecurrenceJson.
    servicingLinks: (servicingLinks.data ?? []) as unknown as ServiceServicingRow[],
  };
}

/**
 * The Clients page: the roster, and the roles, people and services it links
 * to (issue #18), with the live pipeline and its servicing processes to
 * simulate each client's health and churn (issue #19).
 */
export async function loadRoster(slug: string): Promise<RosterData | null> {
  const supabase = await createClient();
  const { data: workspace, error } = await supabase.from("workspaces").select("id, name, slug, settings").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!workspace) return null;
  const ws = workspace.id;
  const [canEdit, roles, people, personRoles, services, roster, simulation] = await Promise.all([
    supabase.rpc("can_edit_workspace", { ws }),
    supabase.from("roles").select("id, name, color, headcount, default_cost_rate, ongoing_hours_per_client_week").eq("workspace_id", ws).order("name"),
    supabase.from("people").select("id, name, fte, capacity_hours_week, active").eq("workspace_id", ws).order("name"),
    supabase.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
    supabase.from("services").select(SERVICE_COLUMNS).eq("workspace_id", ws).order("created_at").order("id"),
    loadClients(supabase, ws),
    loadLiveProcessBySlug(supabase, slug),
  ]);
  for (const r of [canEdit, roles, people, personRoles, services]) if (r.error) throw r.error;
  return {
    workspace: { ...workspace, settings: workspace.settings as unknown as WorkspaceSettings },
    canEdit: canEdit.data === true,
    roles: roles.data ?? [],
    people: people.data ?? [],
    personRoles: personRoles.data ?? [],
    // The cast narrows pricing_model and gives fallback_ongoing_load its shape.
    services: (services.data ?? []) as ServiceRow[],
    ...roster,
    servicingLinks: simulation?.servicingLinks ?? [],
    simulation,
  };
}
