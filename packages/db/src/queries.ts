import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type {
  ClientAssignmentRow,
  ClientRow,
  ClientServiceRow,
  DemandSettingsRow,
  IssueRow,
  LeadSourceRow,
  ProcessBundle,
  ProcessRevisionRow,
  ProcessRow,
  ScenarioRow,
  SeasonalityRow,
  ServiceRow,
  StepRow,
  WorkspaceRow,
  WorkspaceSettings,
} from "./types";

// Reads shared by the web app (signed-in session) and the MCP server (API
// token). Both pass a client that acts as the user, so RLS decides what is
// visible; the service-role key is never used here.

export type Db = SupabaseClient<Database>;

/** Rows a query returned, or its error thrown. */
function rows<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** The `ServiceRow` columns. */
export const SERVICE_COLUMNS =
  "id, workspace_id, name, pricing_model, price, margin, tenure_months, churn_monthly_base, mix_share, entry_process_id, path_tags, fallback_ongoing_load, active" as const;

/** The `ClientRow`, `ClientServiceRow` and `ClientAssignmentRow` columns. */
export const CLIENT_COLUMNS = "id, workspace_id, name, start_date, mrr, health, provenance, notes, active" as const;
export const CLIENT_SERVICE_COLUMNS = "client_id, service_id, workspace_id, start_date" as const;
export const CLIENT_ASSIGNMENT_COLUMNS = "client_id, role_id, person_id, workspace_id" as const;

/** A workspace's client roster: clients by name, their services and assignments. */
export async function loadClients(
  db: Db,
  workspaceId: string,
): Promise<{ clients: ClientRow[]; clientServices: ClientServiceRow[]; clientAssignments: ClientAssignmentRow[] }> {
  const [clients, clientServices, clientAssignments] = await Promise.all([
    db.from("clients").select(CLIENT_COLUMNS).eq("workspace_id", workspaceId).order("name").order("id"),
    db.from("client_services").select(CLIENT_SERVICE_COLUMNS).eq("workspace_id", workspaceId),
    db.from("client_assignments").select(CLIENT_ASSIGNMENT_COLUMNS).eq("workspace_id", workspaceId),
  ]);
  return {
    // provenance is jsonb; ClientRow gives it its shape.
    clients: (rows(clients) ?? []) as ClientRow[],
    clientServices: rows(clientServices) ?? [],
    clientAssignments: rows(clientAssignments) ?? [],
  };
}

/** The `LeadSourceRow`, `SeasonalityRow` and `DemandSettingsRow` columns. */
export const LEAD_SOURCE_COLUMNS = "id, workspace_id, name, volume_week, conversion_to_qualified, provenance" as const;
export const SEASONALITY_COLUMNS = "id, workspace_id, month, multiplier, provenance" as const;
export const DEMAND_SETTINGS_COLUMNS = "workspace_id, growth_monthly, provenance" as const;

/** Load one process revision with everything needed to render and simulate it. */
export async function loadProcessBundle(
  db: Db,
  workspace: Pick<WorkspaceRow, "id" | "name" | "slug"> & { settings: unknown },
  process: ProcessRow,
  revisionId: string,
): Promise<ProcessBundle> {
  const ws = workspace.id;
  const [revision, roles, steps, edges, people, personRoles, personSkills, personLeave, services, leadSources, seasonality, demand, roster] =
    await Promise.all([
      db.from("process_revisions").select("id, workspace_id, process_id, number, status").eq("id", revisionId).single(),
      db.from("roles").select("*").eq("workspace_id", ws),
      db.from("steps").select("*").eq("revision_id", revisionId),
      db.from("edges").select("*").eq("revision_id", revisionId),
      db.from("people").select("id, workspace_id, name, fte, capacity_hours_week, cost_rate, active, start_date, end_date").eq("workspace_id", ws),
      db.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
      db.from("person_skills").select("person_id, step_id, workspace_id").eq("workspace_id", ws),
      db.from("person_leave").select("id, person_id, workspace_id, start_date, end_date").eq("workspace_id", ws),
      db.from("services").select(SERVICE_COLUMNS).eq("workspace_id", ws),
      db.from("lead_sources").select(LEAD_SOURCE_COLUMNS).eq("workspace_id", ws),
      db.from("seasonality").select(SEASONALITY_COLUMNS).eq("workspace_id", ws),
      db.from("demand_settings").select(DEMAND_SETTINGS_COLUMNS).eq("workspace_id", ws).maybeSingle(),
      loadClients(db, ws),
    ]);

  // The casts narrow text columns that check constraints already limit, and the settings jsonb.
  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, settings: workspace.settings as WorkspaceSettings },
    process,
    revision: rows(revision) as ProcessRevisionRow,
    roles: rows(roles) ?? [],
    steps: (rows(steps) ?? []) as StepRow[],
    edges: rows(edges) ?? [],
    people: rows(people) ?? [],
    personRoles: rows(personRoles) ?? [],
    personSkills: rows(personSkills) ?? [],
    personLeave: rows(personLeave) ?? [],
    // pricing_model is check-constrained; fallback_ongoing_load is jsonb.
    services: (rows(services) ?? []) as ServiceRow[],
    // Provenance is jsonb; LeadSourceRow and the others give it its shape.
    leadSources: (rows(leadSources) ?? []) as LeadSourceRow[],
    seasonality: (rows(seasonality) ?? []) as SeasonalityRow[],
    demand: rows(demand) as DemandSettingsRow | null,
    ...roster,
  };
}

const PROCESS_COLUMNS = "id, workspace_id, name, kind, entity_name, description, live_revision_id" as const;

/** A workspace's processes, oldest first. */
export async function listProcesses(db: Db, workspaceId: string): Promise<(ProcessRow & { draft_revision_id: string | null })[]> {
  const r = await db
    .from("processes")
    .select(`${PROCESS_COLUMNS}, draft_revision_id`)
    .eq("workspace_id", workspaceId)
    .order("created_at")
    .order("id");
  return rows(r) as (ProcessRow & { draft_revision_id: string | null })[];
}

/**
 * The workspace's first process at its live revision, or null if not visible.
 * Only the live revision: simulation, forecasts and reports never see a draft.
 */
export async function loadLiveProcessBySlug(db: Db, slug: string): Promise<ProcessBundle | null> {
  return (await loadProcessBySlug(db, slug, { draft: false }))?.live ?? null;
}

/**
 * The workspace's first process at its live revision, and its draft revision
 * if one is open (for the editor; issue #9). Null if not visible.
 */
export async function loadProcessBySlug(
  db: Db,
  slug: string,
  { draft = true }: { draft?: boolean } = {},
): Promise<{ live: ProcessBundle; draft: ProcessBundle | null } | null> {
  const { data: workspace, error } = await db.from("workspaces").select("id, name, slug, settings").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!workspace) return null;
  const process = (await listProcesses(db, workspace.id)).find((p) => p.live_revision_id);
  if (!process) return null;
  const { draft_revision_id: draftId, ...row } = process;
  const [live, drafted] = await Promise.all([
    loadProcessBundle(db, workspace, row, process.live_revision_id as string),
    draft && draftId ? loadProcessBundle(db, workspace, row, draftId) : null,
  ]);
  return { live, draft: drafted };
}

export const SCENARIO_COLUMNS = "id, workspace_id, name, description, patch, parent_scenario_id" as const;

/** A workspace's saved scenarios, oldest first. */
export async function loadScenarios(db: Db, workspaceId: string): Promise<ScenarioRow[]> {
  const r = await db.from("scenarios").select(SCENARIO_COLUMNS).eq("workspace_id", workspaceId).order("created_at").order("name");
  // The database checks patch's shape (private.is_scenario_patch).
  return rows(r) as unknown as ScenarioRow[];
}

export const ISSUE_COLUMNS =
  "id, workspace_id, process_id, step_id, role_id, person_id, type, severity, title, evidence, evidence_metrics, owner_person_id, status, scenario_id, source, detected_key, resolved_at, created_at, updated_at" as const;

/** A workspace's tracked issues (manual and promoted), newest first. */
export async function loadIssues(db: Db, workspaceId: string): Promise<IssueRow[]> {
  const r = await db.from("issues").select(ISSUE_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id");
  // Check constraints limit type, severity, status and source to IssueRow's unions.
  return rows(r) as unknown as IssueRow[];
}
