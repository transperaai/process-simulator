import "server-only";
import { loadAnalysisRules, type AnalysisRules } from "@transpera-flow/db";
import { createClient } from "../supabase/server";

/**
 * The workspace's analysis rules (RLS: every member reads them); no row means the defaults. If they can't be read
 * (say the table isn't there yet), the pages that only rate with them fall back to the defaults rather than break.
 */
export async function loadWorkspaceAnalysisRules(workspaceId: string): Promise<AnalysisRules> {
  try {
    return await loadAnalysisRules(await createClient(), workspaceId);
  } catch (err) {
    console.error("Couldn't load the analysis rules; using the defaults.", err instanceof Error ? err.message : err);
    return { settings: {}, version: null };
  }
}
