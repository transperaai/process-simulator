import "server-only";
import type { ProcessBundle, ProcessRevisionRow, ProcessRow, StepRow, WorkspaceRow, WorkspaceSettings } from "@transpera-flow/db";
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
