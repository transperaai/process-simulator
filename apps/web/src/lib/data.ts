import "server-only";
import type { ProcessBundle, WorkspaceRow } from "@flowsim/db";
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
  const [revision, roles, steps, edges] = await Promise.all([
    supabase.from("process_revisions").select("id, workspace_id, process_id, number, status").eq("id", rev).single(),
    supabase.from("roles").select("*").eq("workspace_id", workspace.id),
    supabase.from("steps").select("*").eq("revision_id", rev),
    supabase.from("edges").select("*").eq("revision_id", rev),
  ]);
  for (const r of [revision, roles, steps, edges]) if (r.error) throw r.error;

  return {
    workspace,
    process,
    revision: revision.data,
    roles: roles.data ?? [],
    steps: steps.data ?? [],
    edges: edges.data ?? [],
  } as ProcessBundle;
}
