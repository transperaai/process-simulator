import type { Json } from "./database.types";
import type { Db } from "./queries";
import type { AiAnalysisRow, AiAnalysisStatus, AiAnalysisTrigger } from "./types";

// AI analysis storage (issue #111, A46): the five switches per workspace, and what AI wrote about each process
// version. Reads and writes run as the signed-in user, so RLS decides: every member reads, owners and editors write.
// What the stored JSON means, and the number check that gates it, are in the app (apps/web/src/lib/ai); this module
// only stores and finds it.

export const AI_SETTING_KEYS = ["review_on_publish", "review_on_market", "suggest_issues", "suggest_solutions", "read_sources"] as const;
export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];
export type AiSettings = Record<AiSettingKey, boolean>;

/** What a workspace with no row gets (the column defaults): reading sources is off until someone turns it on. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  review_on_publish: true,
  review_on_market: true,
  suggest_issues: true,
  suggest_solutions: true,
  read_sources: false,
};

/** The workspace's switches: the defaults when there is no row. */
export async function loadAiSettings(db: Db, workspaceId: string): Promise<AiSettings> {
  const { data, error } = await db
    .from("ai_settings")
    .select("review_on_publish, review_on_market, suggest_issues, suggest_solutions, read_sources")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data } : { ...DEFAULT_AI_SETTINGS };
}

export type SaveAiSettingOutcome = { status: "saved"; settings: AiSettings } | { status: "forbidden" } | { status: "invalid" } | { status: "error"; message: string };

/**
 * Change one switch. Only that column is written (an upsert of one column), so two people flipping different switches
 * can't undo each other; a workspace with no row gets one, with the defaults for the rest.
 */
export async function saveAiSetting(db: Db, workspaceId: string, key: string, value: boolean): Promise<SaveAiSettingOutcome> {
  if (!(AI_SETTING_KEYS as readonly string[]).includes(key) || typeof value !== "boolean") return { status: "invalid" };
  const row: Partial<AiSettings> & { workspace_id: string } = { workspace_id: workspaceId, [key as AiSettingKey]: value };
  const { error } = await db.from("ai_settings").upsert(row, { onConflict: "workspace_id" });
  if (error) return error.code === "42501" ? { status: "forbidden" } : { status: "error", message: "Couldn't save. Try again." };
  return { status: "saved", settings: await loadAiSettings(db, workspaceId) };
}

const ANALYSIS_COLUMNS = "id, workspace_id, process_id, revision_id, status, reason, trigger, summary, insights, review, checked, dropped, input_hash, model, usage, created_at, updated_at";

/** The stored analyses of these revisions (RLS: every member reads), by revision id. */
export async function loadAiAnalyses(db: Db, revisionIds: readonly string[]): Promise<Record<string, AiAnalysisRow>> {
  if (!revisionIds.length) return {};
  const { data, error } = await db.from("ai_analyses").select(ANALYSIS_COLUMNS).in("revision_id", [...revisionIds]);
  if (error) throw error;
  return Object.fromEntries((data as unknown as AiAnalysisRow[]).map((r) => [r.revision_id, r]));
}

export interface SaveAiAnalysisInput {
  workspace_id: string;
  process_id: string;
  revision_id: string;
  status: AiAnalysisStatus;
  reason: string | null;
  trigger: AiAnalysisTrigger;
  summary: Json;
  insights: Json;
  review: Json;
  checked: number;
  dropped: number;
  input_hash: string;
  model: string | null;
  usage: Json;
}

/** Store (or replace) the analysis of a revision. Owners and editors only; returns false when it couldn't be written. */
export async function saveAiAnalysis(db: Db, input: SaveAiAnalysisInput): Promise<boolean> {
  const { error } = await db.from("ai_analyses").upsert(input, { onConflict: "revision_id" });
  if (error) {
    console.error("Couldn't store the AI analysis.", error.message);
    return false;
  }
  return true;
}
