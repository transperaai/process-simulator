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

const ANALYSIS_COLUMNS = "id, workspace_id, process_id, revision_id, status, reason, trigger, summary, insights, review, checked, dropped, input_hash, model, usage, run_id, created_by, created_at, updated_at";

export type AiAnalysisWithRun = AiAnalysisRow & {
  /** Who ran it (the name recorded when the run was reserved); null if unknown. */
  run_by: string | null;
};

/** The stored analyses of these revisions (RLS: every member reads), by revision id, each with the name of whoever ran it. */
export async function loadAiAnalyses(db: Db, revisionIds: readonly string[]): Promise<Record<string, AiAnalysisWithRun>> {
  if (!revisionIds.length) return {};
  const { data, error } = await db.from("ai_analyses").select(ANALYSIS_COLUMNS).in("revision_id", [...revisionIds]);
  if (error) throw error;
  const rows = data as unknown as AiAnalysisRow[];
  const names = new Map<string, string | null>();
  if (rows.length) {
    const runs = await db.from("ai_runs").select("id, user_name").in("id", rows.map((r) => r.run_id));
    if (runs.error) throw runs.error;
    for (const r of runs.data) names.set(r.id, r.user_name);
  }
  return Object.fromEntries(rows.map((r) => [r.revision_id, { ...r, run_by: names.get(r.run_id) ?? null }]));
}

export type AiReservation =
  | { status: "ok"; runId: string }
  /** The workspace has used its runs for the day. */
  | { status: "limit" }
  /** The process was run less than a minute ago. */
  | { status: "cooldown"; retryAfterSeconds: number }
  /** Not an editor of the workspace, or not a process of it. */
  | { status: "forbidden" }
  | { status: "error" };

/** Most model runs a workspace may start in 24 hours, and the quiet time between runs of one process (both enforced by `reserve_ai_run`). */
export const AI_DAILY_RUN_LIMIT = 40;
export const AI_RUN_COOLDOWN_SECONDS = 60;

/**
 * Reserve a model run before calling the model (A46). The database counts it, so the cap holds however the app is
 * called: manual runs, failed runs and market triggers all reserve first.
 */
export async function reserveAiRun(db: Db, workspaceId: string, processId: string, trigger: AiAnalysisTrigger): Promise<AiReservation> {
  const { data, error } = await db.rpc("reserve_ai_run", { p_workspace: workspaceId, p_process: processId, p_trigger: trigger });
  if (error) return { status: "error" };
  const r = data as { status?: string; id?: string; retry_after_seconds?: number } | null;
  if (r?.status === "ok" && r.id) return { status: "ok", runId: r.id };
  if (r?.status === "limit") return { status: "limit" };
  if (r?.status === "cooldown") return { status: "cooldown", retryAfterSeconds: r.retry_after_seconds ?? AI_RUN_COOLDOWN_SECONDS };
  if (r?.status === "forbidden") return { status: "forbidden" };
  return { status: "error" };
}

/**
 * Note that the market changed now, and return the mark: a later change moves it, so only the last change's run finds it
 * still in place (`claimMarketPending`). Null if it couldn't be written (the caller isn't an editor).
 */
export async function markMarketPending(db: Db, workspaceId: string, now: Date = new Date()): Promise<string | null> {
  const at = now.toISOString();
  const { error } = await db.from("ai_settings").upsert({ workspace_id: workspaceId, market_pending_at: at }, { onConflict: "workspace_id" });
  return error ? null : at;
}

/** Claim the pending market review if `mark` is still the latest: true for exactly one caller, once. */
export async function claimMarketPending(db: Db, workspaceId: string, mark: string): Promise<boolean> {
  const { data, error } = await db.from("ai_settings").update({ market_pending_at: null }).eq("workspace_id", workspaceId).eq("market_pending_at", mark).select("workspace_id");
  return !error && data.length > 0;
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
  /** The run reserved for this analysis (`reserveAiRun`). */
  run_id: string;
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
