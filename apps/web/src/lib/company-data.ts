import "server-only";
import { cache } from "react";
import {
  ACTIVE_STORED_STATUSES,
  loadCompanyModel,
  loadLiveRevisions,
  loadSources,
  loadSuggestions,
  snapshotModel,
  type CompanyModel,
  type SuggestionRow,
} from "@transpera-flow/db";
import { COMPANY_AUDIT_TABLES, type AuditEntry } from "./suggestions/audit";
import { createClient } from "./supabase/server";

// Reads for the Suggestions page (issue #25), as the signed-in user
// (RLS decides what's visible).

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface WorkspaceHead {
  id: string;
  name: string;
  slug: string;
}

async function workspaceBySlug(supabase: Supabase, slug: string) {
  const { data, error } = await supabase.from("workspaces").select("id, name, slug, settings, provenance").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

/** The company model as it is now, and the snapshot a run saved now would keep. */
export async function currentModel(supabase: Supabase, workspace: { id: string; name: string; slug: string; settings: unknown; provenance?: unknown }) {
  const [model, processes] = await Promise.all([loadCompanyModel(supabase, workspace), loadLiveRevisions(supabase, workspace.id)]);
  return { model, snapshot: snapshotModel(model, processes), processes };
}

export interface SuggestionsPageData {
  workspace: WorkspaceHead;
  canEdit: boolean;
  suggestions: SuggestionRow[];
  model: CompanyModel;
  /** Titles of the sources suggestions cite. */
  sources: Record<string, string>;
  /** Recent company-model changes, for owners and agency admins (RLS); null for everyone else. */
  changes: AuditEntry[] | null;
  /** User id → email, for the change log (owners and agency admins only). */
  people: Record<string, string>;
}

/** The Suggestions page. */
export async function loadSuggestionsPage(slug: string): Promise<SuggestionsPageData | null> {
  const supabase = await createClient();
  const workspace = await workspaceBySlug(supabase, slug);
  if (!workspace) return null;
  const ws = workspace.id;
  const [canEdit, canManage, suggestions, model, sources] = await Promise.all([
    supabase.rpc("can_edit_workspace", { ws }),
    supabase.rpc("can_manage_workspace", { ws }),
    loadSuggestions(supabase, ws),
    loadCompanyModel(supabase, workspace),
    loadSources(supabase, ws),
  ]);
  if (canEdit.error) throw canEdit.error;
  if (canManage.error) throw canManage.error;
  let changes: AuditEntry[] | null = null;
  const people: Record<string, string> = {};
  if (canManage.data) {
    const [log, members] = await Promise.all([
      supabase
        .from("audit_log")
        .select("id, created_at, actor_id, actor_kind, action, target_table, target_id, diff")
        .eq("workspace_id", ws)
        .in("target_table", [...COMPANY_AUDIT_TABLES])
        .order("created_at", { ascending: false })
        .order("id")
        .limit(50),
      supabase.rpc("workspace_members", { ws }),
    ]);
    if (log.error) throw log.error;
    // actor_kind is check-constrained; diff is jsonb.
    changes = (log.data ?? []) as unknown as AuditEntry[];
    for (const m of members.data ?? []) people[m.user_id] = m.email;
  }
  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    canEdit: canEdit.data === true,
    suggestions,
    model,
    sources: Object.fromEntries(sources.map((s) => [s.id, s.title])),
    changes,
    people,
  };
}

/** The numbers beside the sidebar's Processes and Issues items: how many processes, and tracked issues still open. */
export const shellCounts = cache(async (workspaceId: string): Promise<{ processes: number; openIssues: number }> => {
  const supabase = await createClient();
  const [processes, issues] = await Promise.all([
    supabase.from("processes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ACTIVE_STORED_STATUSES),
  ]);
  if (processes.error) throw processes.error;
  if (issues.error) throw issues.error;
  return { processes: processes.count ?? 0, openIssues: issues.count ?? 0 };
});

/** How many suggestions wait for review (for the workspace nav). */
export const pendingSuggestionCount = cache(async (workspaceId: string): Promise<number> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("suggestions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
});
