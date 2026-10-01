import "server-only";
import { loadAnalysisRules, type AnalysisRules } from "@transpera-flow/db";
import { createClient } from "../supabase/server";

/** The workspace's analysis rules (RLS: every member reads them); no row means the defaults. */
export async function loadWorkspaceAnalysisRules(workspaceId: string): Promise<AnalysisRules> {
  return loadAnalysisRules(await createClient(), workspaceId);
}
