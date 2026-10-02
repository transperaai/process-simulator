import "server-only";

// Running AI analysis on the server and storing it per process version (issue #111, A46; docs/adr/0013-ai-analysis.md).
// Everything runs as the signed-in user under RLS: after a publish or a market change, with the client of the editor who
// made it; for "Run again", with the editor who clicked. There is no service key, so a viewer's click or a stranger's
// request can write nothing. Every model call first reserves a run in the database (`reserve_ai_run`, which counts the
// daily cap and the per-process cooldown where an editor can't reset them), including "Run again" and runs that fail.
//
// It is a long call (a simulation, then one or two model requests), so a trigger never waits for it: callers hand it to
// `after()` and it fails quietly (`runInBackground`). Nothing here throws for a model or database problem.

import {
  AI_DAILY_RUN_LIMIT,
  ModelError,
  claimMarketPending,
  markMarketPending,
  reserveAiRun,
  type AiReservation,
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
/** Most processes one market change reviews. */
export const AI_MARKET_PROCESS_LIMIT = 5;
/** A market change waits this long for further changes before its review starts (a market field saves on every edit). */
export const AI_MARKET_DEBOUNCE_MS = 20_000;
/** After the debounce, no new process review starts once this much time has passed: a request has `maxDuration` 300 s, and one review can take 110 s. */
export const AI_MARKET_BUDGET_MS = 150_000;

export type AiSkip =
  /** The trigger's switch is off. */
  | "switched_off"
  /** The server has no Anthropic API key. */
  | "not_set_up"
  /** The version has no first principles to review. */
  | "no_first_principles"
  /** This process ran less than a minute ago (the database refuses a second run). */
  | "cooldown"
  /** The facts are the ones the stored analysis was made from. */
  | "unchanged"
  /** The workspace has used its model runs for the day (the database counts them). */
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
  /** A manual run ignores the "unchanged" shortcut (it still reserves a run, so it still counts against the cap and the cooldown). */
  force: boolean;
  workspaceId: string;
  processId: string;
  revisionId: string | null;
  settings: AiSettings;
  canWrite: boolean;
  /** The stored analysis of this version, if any. */
  existing: { input_hash: string; status: string } | null;
  /** Load the version and run it. Called only once the cheap checks pass. */
  build: () => Promise<AiRunInput | { error: string }>;
  /** Claude, or null when the server has no key. */
  model: AiModel | null;
  /** Reserve a model run in the database before calling the model: it counts the daily cap and the cooldown. Every model call, failed or not, reserves first. */
  reserve: () => Promise<AiReservation>;
  save: (row: SaveAiAnalysisInput) => Promise<boolean>;
}

/** Decide, run and store one analysis. Pure orchestration over the injected pieces, so it is tested with fakes. */
export async function runAnalysis(deps: AiRunDeps): Promise<AiRunResult> {
  if (!deps.revisionId) return { status: "skipped", why: "no_live" };
  if (!deps.canWrite) return { status: "skipped", why: "forbidden" };
  if (deps.trigger === "publish" && !deps.settings.review_on_publish) return { status: "skipped", why: "switched_off" };
  if (deps.trigger === "market" && !deps.settings.review_on_market) return { status: "skipped", why: "switched_off" };
  if (!deps.model) return { status: "skipped", why: "not_set_up" };

  const built = await deps.build();
  if ("error" in built) return { status: "skipped", why: "model_error", message: built.error };
  const made = aiInputForRun({ ...built, quotes: deps.settings.read_sources ? quotesFromBundle(built.bundle) : null });
  if (!made) return { status: "skipped", why: "no_first_principles" };
  if (!deps.force && deps.existing?.status === "ok" && deps.existing.input_hash === made.input.hash) return { status: "skipped", why: "unchanged" };

  // The one place the model is called: reserve first, so the database has counted the run whatever happens next.
  const reservation = await deps.reserve();
  if (reservation.status === "limit") return { status: "skipped", why: "limit", message: `This workspace has used its ${AI_DAILY_RUN_LIMIT} AI runs for the day.` };
  if (reservation.status === "cooldown") return { status: "skipped", why: "cooldown", message: `AI reviewed this process a moment ago. Try again in ${reservation.retryAfterSeconds} seconds.` };
  if (reservation.status === "forbidden") return { status: "skipped", why: "forbidden" };
  if (reservation.status === "error") return { status: "error", message: "AI analysis couldn't start. Try again." };

  const outcome = await analyseWithAi(made.input, deps.model);
  const stored = await deps.save({
    run_id: reservation.runId,
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
  { trigger, force = false, model = anthropicAnalyst() }: { trigger: AiAnalysisTrigger; force?: boolean; model?: AiModel | null },
): Promise<AiRunResult> {
  try {
    const { data: process, error } = await db.from("processes").select("id, workspace_id, live_revision_id, is_company").eq("id", processId).maybeSingle();
    if (error || !process) return { status: "error", message: "That process isn't available." };
    if (process.is_company) return { status: "error", message: "The company map can't be analysed: it is a picture of the business, not a process." };
    const workspaceId = process.workspace_id;
    const revisionId = process.live_revision_id;
    const [settings, canWrite, existing] = await Promise.all([
      loadAiSettings(db, workspaceId),
      db.rpc("can_edit_workspace", { ws: workspaceId }),
      revisionId ? loadAiAnalyses(db, [revisionId]) : Promise.resolve({}),
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
      existing: row ? { input_hash: row.input_hash, status: row.status } : null,
      build: () => loadRun(db, workspaceId, processId, revisionId!),
      model,
      reserve: () => reserveAiRun(db, workspaceId, processId, trigger),
      save: (r) => saveAiAnalysis(db, r),
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

export interface MarketRunDeps {
  /** Note that the market changed now; returns the mark (null: couldn't be written, so nothing runs). */
  mark: () => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  /** Claim the pending review if `mark` is still the latest change's. */
  claim: (mark: string) => Promise<boolean>;
  /** The processes to review, in order. */
  processes: () => Promise<string[]>;
  /** Review one process. */
  run: (processId: string) => Promise<unknown>;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * A market change, debounced and bounded. Every change moves a mark and waits; only the last change's run still finds its
 * mark in place, claims it and reviews, so a burst of edits makes one review, not one per edit. The review goes through
 * the processes one at a time and starts no new one once the time budget is spent, logging the ones it left (each run
 * reserves its own run in the database, so the daily cap holds either way).
 */
export async function debouncedMarketRun(deps: MarketRunDeps): Promise<{ ran: string[]; skipped: string[] }> {
  const none = { ran: [], skipped: [] };
  const mark = await deps.mark();
  if (!mark) return none;
  await deps.sleep(AI_MARKET_DEBOUNCE_MS);
  if (!(await deps.claim(mark))) return none;
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const id of (await deps.processes()).slice(0, AI_MARKET_PROCESS_LIMIT)) {
    if (now() - started > AI_MARKET_BUDGET_MS) {
      skipped.push(id);
      continue;
    }
    await deps.run(id);
    ran.push(id);
  }
  if (skipped.length) (deps.log ?? console.warn)(`AI market review: left ${skipped.length} process(es) for the next change, out of time: ${skipped.join(", ")}`);
  return { ran, skipped };
}

/** After a market change: review the workspace's live processes if the switch is on and there is a key (debounced, see `debouncedMarketRun`). */
export async function runAiAnalysisAfterMarketChange(db: Db, workspaceId: string, model: AiModel | null = anthropicAnalyst()): Promise<void> {
  if (!model) return;
  if (!(await loadAiSettings(db, workspaceId)).review_on_market) return;
  await debouncedMarketRun({
    mark: () => markMarketPending(db, workspaceId),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    claim: (mark) => claimMarketPending(db, workspaceId, mark),
    processes: async () => (await listProcesses(db, workspaceId)).filter((p) => p.live_revision_id && p.kind !== "servicing").map((p) => p.id),
    run: (id) => runAiAnalysis(db, id, { trigger: "market", model }),
  });
}
