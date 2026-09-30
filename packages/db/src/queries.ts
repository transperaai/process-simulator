import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { CompanyModel, SnapshotProcess } from "./company";
import type { CitingRow } from "./evidence";
import { partitionSteps } from "./retired";
import type { RunRow } from "./runs";
import type {
  ClientAssignmentRow,
  ClientRow,
  ClientServiceRow,
  DemandSettingsRow,
  IssueRow,
  LeadSourceRow,
  PersonRow,
  ProcessBundle,
  ProcessRevisionRow,
  ProcessRow,
  ProvenanceMap,
  ScenarioRow,
  SeasonalityRow,
  ServiceRow,
  SourceRow,
  StepRow,
  SuggestionRow,
  SuggestionStatus,
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

  // Split or replaced steps stay in the revision for scenarios to re-point, never drawn or simulated (./retired.ts).
  const { steps: inUse, retired } = partitionSteps((rows(steps) ?? []) as StepRow[]);
  // The casts narrow text columns that check constraints already limit, and the settings jsonb.
  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, settings: workspace.settings as WorkspaceSettings },
    process,
    revision: rows(revision) as ProcessRevisionRow,
    roles: rows(roles) ?? [],
    steps: inUse,
    retired,
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
  "id, workspace_id, process_id, step_id, role_id, person_id, client_id, type, severity, title, evidence, evidence_metrics, owner_person_id, status, scenario_id, source, detected_key, resolved_at, created_at, updated_at" as const;

/** A workspace's tracked issues (manual and promoted), newest first. */
export async function loadIssues(db: Db, workspaceId: string): Promise<IssueRow[]> {
  const r = await db.from("issues").select(ISSUE_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id");
  // Check constraints limit type, severity, status and source to IssueRow's unions.
  return rows(r) as unknown as IssueRow[];
}

/** The `SourceRow` columns. */
export const SOURCE_COLUMNS = "id, workspace_id, kind, title, speakers, recorded_at, body, file_url, created_at, updated_at" as const;

/** The workspace's sources, most recent first (RLS: everyone in the workspace can read them). */
export async function loadSources(db: Db, workspaceId: string): Promise<SourceRow[]> {
  const r = await db
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("recorded_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id");
  // The check constraint limits kind to SourceRow's union.
  return rows(r) as unknown as SourceRow[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Every row of the workspace that can cite a source: the steps of each
 * process's live revision and open draft, and the demand rows. For the Sources
 * page's "what cites this" (evidence.ts `citationsBySource`).
 */
export async function loadCitingRows(db: Db, workspaceId: string): Promise<CitingRow[]> {
  const processes = await listProcesses(db, workspaceId);
  const revisions = new Map<string, "live" | "draft">();
  for (const p of processes) {
    if (p.live_revision_id) revisions.set(p.live_revision_id, "live");
    if (p.draft_revision_id) revisions.set(p.draft_revision_id, "draft");
  }
  const [steps, leadSources, seasonality, demand] = await Promise.all([
    revisions.size
      ? db.from("steps").select("id, name, process_id, revision_id, provenance, replaced_by").in("revision_id", [...revisions.keys()])
      : Promise.resolve({ data: [], error: null }),
    db.from("lead_sources").select("id, name, provenance").eq("workspace_id", workspaceId),
    db.from("seasonality").select("id, month, provenance").eq("workspace_id", workspaceId),
    db.from("demand_settings").select("workspace_id, provenance").eq("workspace_id", workspaceId),
  ]);
  return [
    // Retired steps (split or replaced, issue #16) are no longer part of the process.
    ...partitionSteps(rows(steps)).steps.map((s) => ({
      table: "steps",
      id: s.id,
      name: s.name,
      processId: s.process_id,
      revision: revisions.get(s.revision_id)!,
      provenance: s.provenance,
    })),
    ...rows(leadSources).map((l) => ({ table: "lead_sources", id: l.id, name: l.name, provenance: l.provenance })),
    ...rows(seasonality).map((m) => ({
      table: "seasonality",
      id: m.id,
      name: `Seasonality: ${MONTHS[m.month - 1] ?? m.month}`,
      provenance: m.provenance,
    })),
    ...rows(demand).map((d) => ({ table: "demand_settings", id: d.workspace_id, name: "Demand growth", provenance: d.provenance })),
  ];
}

// ---------------------------------------------------------------------------
// Company model, suggestions and saved runs (issue #25)
// ---------------------------------------------------------------------------

const PERSON_COLUMNS = "id, workspace_id, name, fte, capacity_hours_week, cost_rate, active, start_date, end_date, provenance" as const;

/** The workspace's company model: roles, people, services, clients and demand, with provenance. */
export async function loadCompanyModel(
  db: Db,
  workspace: Pick<WorkspaceRow, "id" | "name" | "slug"> & { settings: unknown; provenance?: unknown },
): Promise<CompanyModel> {
  const ws = workspace.id;
  const [roles, people, personRoles, personLeave, services, leadSources, seasonality, demand, roster] = await Promise.all([
    db.from("roles").select("*").eq("workspace_id", ws).order("name"),
    db.from("people").select(PERSON_COLUMNS).eq("workspace_id", ws).order("name"),
    db.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
    db.from("person_leave").select("id, person_id, workspace_id, start_date, end_date").eq("workspace_id", ws),
    db.from("services").select(`${SERVICE_COLUMNS}, provenance`).eq("workspace_id", ws).order("name"),
    db.from("lead_sources").select(LEAD_SOURCE_COLUMNS).eq("workspace_id", ws).order("created_at").order("id"),
    db.from("seasonality").select(SEASONALITY_COLUMNS).eq("workspace_id", ws).order("month"),
    db.from("demand_settings").select(DEMAND_SETTINGS_COLUMNS).eq("workspace_id", ws).maybeSingle(),
    loadClients(db, ws),
  ]);
  // The casts give jsonb columns (settings, provenance) their shapes and narrow check-constrained text.
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      settings: workspace.settings as WorkspaceSettings,
      ...(workspace.provenance ? { provenance: workspace.provenance as ProvenanceMap } : {}),
    },
    roles: rows(roles) ?? [],
    people: (rows(people) ?? []) as PersonRow[],
    personRoles: rows(personRoles) ?? [],
    personLeave: rows(personLeave) ?? [],
    services: (rows(services) ?? []) as ServiceRow[],
    leadSources: (rows(leadSources) ?? []) as LeadSourceRow[],
    seasonality: (rows(seasonality) ?? []) as SeasonalityRow[],
    demand: rows(demand) as DemandSettingsRow | null,
    ...roster,
  };
}

/** Each process's live revision (for run snapshots and "model changed since this run"). */
export async function loadLiveRevisions(db: Db, workspaceId: string): Promise<SnapshotProcess[]> {
  const processes = await listProcesses(db, workspaceId);
  const ids = processes.flatMap((p) => (p.live_revision_id ? [p.live_revision_id] : []));
  if (!ids.length) return [];
  const revisions = rows(await db.from("process_revisions").select("id, number").in("id", ids));
  return processes.flatMap((p) => {
    const r = revisions.find((x) => x.id === p.live_revision_id);
    return r ? [{ id: p.id, name: p.name, revision_id: r.id, revision: r.number }] : [];
  });
}

export const SUGGESTION_ROW_COLUMNS =
  "id, workspace_id, target_table, target_id, patch, evidence, note, status, created_via, applied, review_note, reviewed_by, reviewed_at, created_at, created_by" as const;

/** The workspace's suggestions, newest first; optionally only one status. */
export async function loadSuggestions(db: Db, workspaceId: string, status?: SuggestionStatus): Promise<SuggestionRow[]> {
  let q = db.from("suggestions").select(SUGGESTION_ROW_COLUMNS).eq("workspace_id", workspaceId);
  if (status) q = q.eq("status", status);
  const r = await q.order("created_at", { ascending: false }).order("id").limit(500);
  // Check constraints limit the text columns; patch, evidence and applied are jsonb.
  return rows(r) as unknown as SuggestionRow[];
}

export const RUN_COLUMNS =
  "id, workspace_id, process_id, name, scenario_id, revision_ids, engine_version, reps, seed, params_snapshot, results, duration_ms, created_at, created_by" as const;

/** The workspace's saved runs, newest first. */
export async function loadRuns(db: Db, workspaceId: string): Promise<RunRow[]> {
  const r = await db
    .from("runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(200);
  // params_snapshot and results are jsonb; RunRow gives them their shapes.
  return rows(r) as unknown as RunRow[];
}

/** One saved run, or null if it isn't visible. */
export async function loadRun(db: Db, id: string): Promise<RunRow | null> {
  const r = await db.from("runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  return rows(r) as unknown as RunRow | null;
}
