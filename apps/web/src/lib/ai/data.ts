import "server-only";
import { DEFAULT_AI_SETTINGS, loadAiAnalyses, loadAiSettings, type AiSettings } from "@transpera-flow/db";
import { narrationConfigured } from "@/lib/narration/anthropic";
import { createClient } from "../supabase/server";
import { aiViewFromRow, type AiAnalysisView } from "./types";

/** Whether this server has an Anthropic API key (the one narration uses): without it AI analysis says it isn't set up. */
export const aiConfigured = (): boolean => narrationConfigured();

/** The workspace's AI switches (RLS: every member reads); the defaults if they can't be read (say the table isn't there yet). */
export async function loadWorkspaceAiSettings(workspaceId: string): Promise<AiSettings> {
  try {
    return await loadAiSettings(await createClient(), workspaceId);
  } catch (err) {
    console.error("Couldn't load the AI settings; using the defaults.", err instanceof Error ? err.message : err);
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/** The stored AI analyses of these versions (RLS: every member reads), by revision id; none if they can't be read. */
export async function loadAiViews(revisionIds: readonly string[]): Promise<Record<string, AiAnalysisView>> {
  try {
    const rows = await loadAiAnalyses(await createClient(), revisionIds);
    return Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, aiViewFromRow(row)]));
  } catch (err) {
    console.error("Couldn't load the AI analysis; showing none.", err instanceof Error ? err.message : err);
    return {};
  }
}
