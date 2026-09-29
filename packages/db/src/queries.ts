import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { ProcessBundle, ProcessRevisionRow, ProcessRow, StepRow, WorkspaceRow, WorkspaceSettings } from "./types";

// Reads shared by the web app (signed-in session) and the MCP server (API
// token). Both pass a client that acts as the user, so RLS decides what is
// visible; the service-role key is never used here.

export type Db = SupabaseClient<Database>;

/** Rows a query returned, or its error thrown. */
function rows<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** Load one process revision with everything needed to render and simulate it. */
export async function loadProcessBundle(
  db: Db,
  workspace: Pick<WorkspaceRow, "id" | "name" | "slug"> & { settings: unknown },
  process: ProcessRow,
  revisionId: string,
): Promise<ProcessBundle> {
  const ws = workspace.id;
  const [revision, roles, steps, edges, people, personRoles, personSkills, personLeave] = await Promise.all([
    db.from("process_revisions").select("id, workspace_id, process_id, number, status").eq("id", revisionId).single(),
    db.from("roles").select("*").eq("workspace_id", ws),
    db.from("steps").select("*").eq("revision_id", revisionId),
    db.from("edges").select("*").eq("revision_id", revisionId),
    db.from("people").select("id, workspace_id, name, fte, capacity_hours_week, cost_rate, active, start_date, end_date").eq("workspace_id", ws),
    db.from("person_roles").select("person_id, role_id, workspace_id").eq("workspace_id", ws),
    db.from("person_skills").select("person_id, step_id, workspace_id").eq("workspace_id", ws),
    db.from("person_leave").select("id, person_id, workspace_id, start_date, end_date").eq("workspace_id", ws),
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
