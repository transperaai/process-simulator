import "server-only";

// Running AI analysis on the server and storing it per process version (issue #111, A46; docs/adr/0013-ai-analysis.md).
// Everything runs as the signed-in user under RLS: after a publish or a market change, with the client of the editor who
// made it; for "Run again", with the editor who clicked. There is no service key and no SECURITY DEFINER function, so a
// viewer's click or a stranger's request can write nothing.
//
// It is a long call (a simulation, then one or two model requests), so a trigger never waits for it: callers hand it to
// `after()` and it fails quietly (`runInBackground`). Nothing here throws for a model or database problem.

import {
  ModelError,
  loadAiAnalyses,
  loadAiSettings,
  loadAnalysisRules,
  loadFirstPrinciplesFor,
  loadProcessBundle,
  listProcesses,
  saveAiAnalysis,
  toEngineModel,
  type AiAnalysisTrigger,
  type AiSettings,
  type Db,
  type ProcessBundle,
  type SaveAiAnalysisInput,
} from "@transpera-flow/db";
import { absenceTest, resolveMoney, shadowPricesFor, simulate, type AbsenceTest, type DetectedIssue } from "@transpera-flow/engine";
import { anthropicAnalyst } from "@/lib/narration/anthropic";
import { analyseWithAi, type AiModel, type AiOutcome } from "./analyse";
import { aiInputForRun, costedRoleIds, quotesFromBundle, ruleFindings, type AiRunInput } from "./input";

/** The replications and seed every page uses, so AI reads the same run the person sees. */
const REPS = 30;
const SEED = 1;
/** Analyses (new ones, not cache hits) a workspace may have in 24 hours. */
export const AI_DAILY_LIMIT = 40;
/** An automatic trigger doesn't re-run a version analysed this recently (a market edit saves on every keystroke). */
export const AI_MIN_GAP_MS = 2 * 60 * 1000;
/** Most processes one market change reviews. */
export const AI_MARKET_PROCESS_LIMIT = 5;

export type AiSkip =
  /** The trigger's switch is off. */
  | "switched_off"
  /** The server has no Anthropic API key. */
  | "not_set_up"
  /** The version has no first principles to review. */
  | "no_first_principles"
  /** The version was analysed a moment ago. */
  | "recent"
  /** The facts are the ones the stored analysis was made from. */
  | "unchanged"
  /** The workspace has used its analyses for the day. */
  | "limit"
  /** The process has no live version. */
  | "no_live"
  /** The user can't write here. */
  | "forbidden"
  /** The model of the process can't be built (a step is broken, say). */
  | "model_error";

export type AiRunResult = { status: "stored"; outcome: AiOutcome } | { status: "skipped"; why: AiSkip; message?: string } | { status: "error"; message: string };

export interface AiRunDeps {
  trigger: AiAnalysisTrigger;
  /** A manual run ignores the gap and the "unchanged" shortcut. */
  force: boolean;
  workspaceId: string;
  processId: string;
  revisionId: string | null;
  settings: AiSettings;
  canWrite: boolean;
  /** The stored analysis of this version, if any. */
  existing: { input_hash: string; status: string; updated_at: string } | null;
  /** Analyses written to this workspace in the last 24 hours. */
  countToday: number;
  /** Load the version and run it. Called only once the cheap checks pass. */
  build: () => Promise<AiRunInput | { error: string }>;
  /** Claude, or null when the server has no key. */
  model: AiModel | null;
  save: (row: SaveAiAnalysisInput) => Promise<boolean>;
  now?: () => Date;
}

/** Decide, run and store one analysis. Pure orchestration over the injected pieces, so it is tested with fakes. */
export async function runAnalysis(deps: AiRunDeps): Promise<AiRunResult> {
  const now = deps.now ?? (() => new Date());
  if (!deps.revisionId) return { status: "skipped", why: "no_live" };
  if (!deps.canWrite) return { status: "skipped", why: "forbidden" };
  if (deps.trigger === "publish" && !deps.settings.review_on_publish) return { status: "skipped", why: "switched_off" };
  if (deps.trigger === "market" && !deps.settings.review_on_market) return { status: "skipped", why: "switched_off" };
  if (!deps.model) return { status: "skipped", why: "not_set_up" };
  if (!deps.force && deps.existing && now().getTime() - new Date(deps.existing.updated_at).getTime() < AI_MIN_GAP_MS && deps.trigger !== "publish") {
    return { status: "skipped", why: "recent" };
  }
  if (deps.countToday >= AI_DAILY_LIMIT) return { status: "skipped", why: "limit", message: `This workspace has used its ${AI_DAILY_LIMIT} AI analyses for the day.` };

  const built = await deps.build();
  if ("error" in built) return { status: "skipped", why: "model_error", message: built.error };
  const made = aiInputForRun({ ...built, quotes: deps.settings.read_sources ? quotesFromBundle(built.bundle) : null });
  if (!made) return { status: "skipped", why: "no_first_principles" };
  if (!deps.force && deps.existing?.status === "ok" && deps.existing.input_hash === made.input.hash) return { status: "skipped", why: "unchanged" };

  const outcome = await analyseWithAi(made.input, deps.model);
  const stored = await deps.save({
    workspace_id: deps.workspaceId,
    process_id: deps.processId,
    revision_id: deps.revisionId,
    status: outcome.status,
    reason: outcome.reason?.slice(0, 2000) ?? null,
    trigger: deps.trigger,
    summary: outcome.summary,
    insights: outcome.insights as unknown as SaveAiAnalysisInput["insights"],
    review: outcome.review as unknown as SaveAiAnalysisInput["review"],
    checked: outcome.checked,
    dropped: outcome.dropped,
    input_hash: made.input.hash,
    model: outcome.model,
    usage: outcome.usage as unknown as SaveAiAnalysisInput["usage"],
  });
  return stored ? { status: "stored", outcome } : { status: "error", message: "The analysis ran but couldn't be saved." };
}

// ---------------------------------------------------------------------------
// The database side
// ---------------------------------------------------------------------------

/** The version of a process as AI reads it: its bundle, its model, one run, the rules and its first principles. Rule 8 and the busy cost take their own extra runs, as on the pages. */
async function loadRun(db: Db, workspaceId: string, processId: string, revisionId: string): Promise<AiRunInput | { error: string }> {
  const { data: workspace, error: wsError } = await db.from("workspaces").select("id, name, slug, settings").eq("id", workspaceId).maybeSingle();
  if (wsError || !workspace) return { error: "The workspace couldn't be read." };
  const process = (await listProcesses(db, workspaceId)).find((p) => p.id === processId);
  if (!process) return { error: "The process couldn't be found." };
  const bundle: ProcessBundle = await loadProcessBundle(db, workspace, process, revisionId);
  let model;
  try {
    model = toEngineModel(bundle);
  } catch (err) {
    if (err instanceof ModelError) return { error: err.message };
    throw err;
  }
  const [rules, fp] = await Promise.all([loadAnalysisRules(db, workspaceId), loadFirstPrinciplesFor(db, processId, [revisionId])]);
  const result = simulate(model, REPS, SEED);
  let absence: AbsenceTest | null = null;
  try {
    absence = absenceTest(model, { seed: SEED, weeks: resolveMoney(rules.settings).absenceWeeks });
  } catch {
    // Without it "only one person can do it" raises nothing, as on a page while the test is still running.
  }
  const firstPrinciples = fp[revisionId]?.doc ?? null;
  // The too-busy cost needs the shadow price of each busy role (an extra run), as the pages compute it.
  const first: DetectedIssue[] = ruleFindings({ bundle, model, result, rules: rules.settings, firstPrinciples, absence });
  const roleIds = costedRoleIds(first);
  let shadowPrices: Record<string, number> | undefined;
  if (roleIds.length) {
    try {
      shadowPrices = shadowPricesFor(model, roleIds, { reps: REPS, seed: SEED });
    } catch {
      // Those costs read "n/a", as on a page whose extra run failed.
    }
  }
  return { bundle, model, result, rules: rules.settings, firstPrinciples, absence, ...(shadowPrices ? { shadowPrices } : {}) };
}

/** The signed-in user's client runs one analysis of a process's live version (or of `revisionId`). */
export async function runAiAnalysis(
  db: Db,
  processId: string,
  { trigger, force = false, model = anthropicAnalyst(), now }: { trigger: AiAnalysisTrigger; force?: boolean; model?: AiModel | null; now?: () => Date },
): Promise<AiRunResult> {
  try {
    const { data: process, error } = await db.from("processes").select("id, workspace_id, live_revision_id").eq("id", processId).maybeSingle();
    if (error || !process) return { status: "error", message: "That process isn't available." };
    const workspaceId = process.workspace_id;
    const revisionId = process.live_revision_id;
    const [settings, canWrite, existing, count] = await Promise.all([
      loadAiSettings(db, workspaceId),
      db.rpc("can_edit_workspace", { ws: workspaceId }),
      revisionId ? loadAiAnalyses(db, [revisionId]) : Promise.resolve({}),
      db
        .from("ai_analyses")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("updated_at", new Date((now?.() ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString()),
    ]);
    const row = revisionId ? (existing as Awaited<ReturnType<typeof loadAiAnalyses>>)[revisionId] : undefined;
    return await runAnalysis({
      trigger,
      force,
      workspaceId,
      processId,
      revisionId,
      settings,
      canWrite: canWrite.data === true,
      existing: row ? { input_hash: row.input_hash, status: row.status, updated_at: row.updated_at } : null,
      countToday: count.count ?? 0,
      build: () => loadRun(db, workspaceId, processId, revisionId!),
      model,
      save: (r) => saveAiAnalysis(db, r),
      ...(now ? { now } : {}),
    });
  } catch (err) {
    console.error("AI analysis failed.", err instanceof Error ? err.message : err);
    return { status: "error", message: "AI analysis couldn't run. Try again." };
  }
}

/** For `after()`: run and swallow everything, so a trigger never breaks the request that started it. */
export async function runInBackground(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error("AI analysis (background) failed.", err instanceof Error ? err.message : err);
  }
}

/** After a market change: review the workspace's live processes (the first few), one after another, if the switch is on. */
export async function runAiAnalysisAfterMarketChange(db: Db, workspaceId: string): Promise<void> {
  const live = (await listProcesses(db, workspaceId)).filter((p) => p.live_revision_id && p.kind !== "servicing").slice(0, AI_MARKET_PROCESS_LIMIT);
  const model = anthropicAnalyst();
  for (const p of live) await runAiAnalysis(db, p.id, { trigger: "market", model });
}
