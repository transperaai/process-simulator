// Generating a report as the signed-in user or an API token's user (issue
// #28; docs/PRD.md §9, §7.1 `export_report`; docs/adr/0009-pdf-reports.md).
// One pipeline for the Reports page and MCP: load the live model under RLS,
// take the saved run (or make and save one), run the comparisons and the
// robustness checks (cached in `robustness_results`), assemble the content,
// store the report, print the PDF with headless Chromium, and hand back a
// download link that works without signing in until it expires.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  changesSinceRun,
  listProcesses,
  loadCompanyModel,
  loadIssues,
  loadLiveRevisions,
  loadProcessBundle,
  loadRun,
  loadScenarios,
  loadSources,
  ModelError,
  runResults,
  snapshotModel,
  toEngineModel,
  type Db,
  type Json,
  type ProvenanceMap,
  type RunResults,
} from "@transpera-flow/db";
import { buildReportContent } from "./assemble";
import type { ReportContent, ReportSectionId } from "./content";
import { REPORT_ENGINE_VERSION } from "./engine-version";
import { REPORT_ROBUSTNESS_BUDGET_MS, REPORT_SHADOW_PRICE_BUDGET_MS } from "./options";
import { renderReportHtml } from "./render";
import { loadRobustnessCache, robustnessCheckKey, saveRobustnessCache } from "./robustness-cache";

/** A problem the person can act on, with a code for MCP. */
export class ReportError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_model" | "model_changed" | "not_reproducible" | "invalid_input" | "write_failed",
    message: string,
  ) {
    super(message);
  }
}

export interface GenerateReportInput {
  workspaceId: string;
  /** The process to report on; a servicing process reports on the pipeline it runs beside. */
  processId: string;
  /** A saved run to report on; null makes (and saves) a new run. */
  runId: string | null;
  /** Replications for a new run. */
  reps: number;
  sections: ReportSectionId[];
  scenarioIds: string[];
  /** Print the PDF (default); `false` stores the content only (MCP `format: json`). */
  pdf?: boolean;
  /** Where links point, e.g. `https://transpera-flow.vercel.app`. */
  origin: string;
  generatedBy: string | null;
  /** ISO timestamp of "now"; a new run starts on its date. */
  now: string;
  /** How long the download link works (default 24 hours, at most 7 days). */
  linkTtlSeconds?: number;
  /** Time for every robustness check together. */
  robustnessBudgetMs?: number;
}

export interface GeneratedReport {
  id: string;
  title: string;
  runId: string;
  /** The download link: the PDF (or `format=json`, the content), no sign-in needed until `expiresAt`. */
  url: string;
  jsonUrl: string;
  expiresAt: string;
  /** False when the PDF couldn't be printed; the report route's "Save as PDF" still works. */
  pdf: boolean;
  pdfError: string | null;
  content: ReportContent;
}

export type PdfRenderer = (html: string) => Promise<Uint8Array>;

const DAY = 24 * 60 * 60;

/** A new download token (32 random bytes, base64url) and the hash the row keeps. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: linkHash(token) };
}

export const linkHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Postgres `bytea` hex, as PostgREST reads and writes it. */
export const toByteaHex = (bytes: Uint8Array) => `\\x${Buffer.from(bytes).toString("hex")}`;
export function fromByteaHex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}

/** The download links for a report and token. */
export function reportLinks(origin: string, id: string, token: string) {
  const base = `${origin.replace(/\/$/, "")}/api/reports/${id}/pdf?token=${encodeURIComponent(token)}`;
  return { url: base, jsonUrl: `${base}&format=json` };
}

const STAT_KEYS = ["won", "lost", "mrr_added", "billed", "overtime_hours"] as const;

/** Whether re-running a saved run gave the numbers it saved (same model, seed and engine). */
export function sameResults(saved: RunResults, now: RunResults): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return STAT_KEYS.every((k) => {
    const a = saved[k];
    const b = now[k];
    return !!a && !!b && close(a.mean, b.mean) && close(a.p10, b.p10) && close(a.p90, b.p90);
  });
}

export async function generateReport(db: Db, input: GenerateReportInput, renderPdf?: PdfRenderer): Promise<GeneratedReport> {
  const wsRead = await db.from("workspaces").select("id, name, slug, settings, provenance").eq("id", input.workspaceId).maybeSingle();
  if (wsRead.error) throw wsRead.error;
  const ws = wsRead.data;
  if (!ws) throw new ReportError("not_found", "That workspace isn't available.");
  const editRead = await db.rpc("can_edit_workspace", { ws: ws.id });
  if (editRead.error) throw editRead.error;
  const canEdit = editRead.data;
  if (!canEdit) throw new ReportError("forbidden", "Reports are for editors, owners and agency admins: they include per-person utilisation.");

  // The pipeline to report on (a servicing process runs beside its pipeline, issue #19).
  const processes = await listProcesses(db, ws.id);
  let process = processes.find((p) => p.id === input.processId);
  if (!process) throw new ReportError("not_found", "That process isn't available.");
  if (process.kind === "servicing") {
    const pipelines = processes.filter((p) => p.kind !== "servicing" && p.live_revision_id);
    if (pipelines.length !== 1) throw new ReportError("invalid_input", "Choose the pipeline to report on; its servicing processes are included.");
    process = pipelines[0]!;
  }
  if (!process.live_revision_id) throw new ReportError("invalid_model", `“${process.name}” hasn't been published yet, so there is nothing live to report on.`);

  const [bundle, scenarios, issues, sources] = await Promise.all([
    loadProcessBundle(db, ws, process, process.live_revision_id),
    loadScenarios(db, ws.id),
    loadIssues(db, ws.id),
    loadSources(db, ws.id),
  ]);
  bundle.workspace.provenance = (ws.provenance ?? {}) as ProvenanceMap;
  const currency = bundle.workspace.settings.currency;

  // The run: a saved one (only if the model is unchanged and it reproduces exactly), or a new one.
  let run: { id: string; name: string; seed: number; reps: number; startDate: string; savedAt: string | null; isNew: boolean };
  if (input.runId) {
    const saved = await loadRun(db, input.runId);
    if (!saved || saved.workspace_id !== ws.id) throw new ReportError("not_found", "That saved run isn't available.");
    if (saved.process_id && saved.process_id !== process.id) throw new ReportError("invalid_input", "That saved run is of another process.");
    const [company, revisions] = await Promise.all([loadCompanyModel(db, ws), loadLiveRevisions(db, ws.id)]);
    const changes = changesSinceRun(saved, snapshotModel(company, revisions));
    if (changes.length) {
      throw new ReportError(
        "model_changed",
        `The model has changed since “${saved.name}” was saved (${changes.length} ${changes.length === 1 ? "change" : "changes"}), so its numbers can't be reproduced. Generate from a new run instead.`,
      );
    }
    run = { id: saved.id, name: saved.name, seed: saved.seed, reps: saved.reps, startDate: saved.created_at.slice(0, 10), savedAt: saved.created_at, isNew: false };
  } else {
    run = { id: randomUUID(), name: `Report run ${input.now.slice(0, 10)}`, seed: 1, reps: input.reps, startDate: input.now.slice(0, 10), savedAt: input.now, isNew: true };
  }

  // Cached robustness jobs of every scenario the report compares.
  let model;
  try {
    model = toEngineModel(bundle, { startDate: run.startDate });
  } catch (err) {
    if (err instanceof ModelError) throw new ReportError("invalid_model", `This process can't be simulated yet: ${err.message}`);
    throw err;
  }
  const chosen = scenarios.filter((s) => input.scenarioIds.includes(s.id));
  const cache = await loadRobustnessCache(db, ws.id, chosen.map((s) => robustnessCheckKey(model, s.patch)));

  const started = performance.now();
  const built = buildReportContent({
    bundle,
    scenarios,
    issues,
    sources,
    run: { id: run.id, name: run.name, seed: run.seed, reps: run.reps, engineVersion: REPORT_ENGINE_VERSION, startDate: run.startDate, savedAt: run.savedAt },
    options: { sections: input.sections, scenarioIds: input.scenarioIds },
    generatedAt: input.now,
    generatedBy: input.generatedBy,
    robustness: { cache, timeBudgetMs: input.robustnessBudgetMs ?? REPORT_ROBUSTNESS_BUDGET_MS },
    shadowPriceBudgetMs: REPORT_SHADOW_PRICE_BUDGET_MS,
  });
  const results = runResults(built.model, built.baseline, currency);

  if (run.isNew) {
    const [company, revisions] = await Promise.all([loadCompanyModel(db, ws), loadLiveRevisions(db, ws.id)]);
    const { error } = await db.from("runs").insert({
      id: run.id,
      workspace_id: ws.id,
      process_id: process.id,
      name: run.name,
      revision_ids: revisions.map((p) => p.revision_id),
      engine_version: REPORT_ENGINE_VERSION,
      reps: run.reps,
      seed: run.seed,
      params_snapshot: snapshotModel(company, revisions) as unknown as Json,
      results: results as unknown as Json,
      duration_ms: Math.round(performance.now() - started),
    });
    if (error) throw new ReportError("write_failed", `Couldn't save the report's run: ${error.message}`);
  } else {
    const saved = (await loadRun(db, run.id))!;
    if (!sameResults(saved.results, results)) {
      throw new ReportError("not_reproducible", `Re-running “${saved.name}” doesn't give the numbers it saved (the engine has changed since). Generate from a new run instead.`);
    }
  }
  await saveRobustnessCache(db, ws.id, run.id, cache).catch(() => 0); // A cache write that fails only costs time next report.

  // Store the report, then print it.
  const content = built.content;
  const { token, hash } = newLinkToken();
  const ttl = Math.min(Math.max(60, input.linkTtlSeconds ?? DAY), 7 * DAY);
  const expiresAt = new Date(Date.parse(input.now) + ttl * 1000).toISOString();
  const inserted = await db
    .from("reports")
    .insert({
      workspace_id: ws.id,
      process_id: process.id,
      run_id: run.id,
      title: content.title,
      options: { sections: input.sections, scenarioIds: input.scenarioIds, reps: run.reps, runId: input.runId } as unknown as Json,
      content: content as unknown as Json,
      content_version: content.version,
      link_hash: hash,
      link_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (inserted.error) throw new ReportError("write_failed", `Couldn't store the report: ${inserted.error.message}`);
  const id = inserted.data.id;

  let pdf = false;
  let pdfError: string | null = null;
  if (input.pdf !== false) {
    try {
      const render = renderPdf ?? (await import("./pdf")).htmlToPdf;
      const bytes = await render(renderReportHtml(content));
      const { error } = await db.from("reports").update({ pdf: toByteaHex(bytes), pdf_generated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
      pdf = true;
    } catch (err) {
      pdfError = err instanceof Error ? err.message : String(err);
    }
  }
  return { id, title: content.title, runId: run.id, ...reportLinks(input.origin, id, token), expiresAt, pdf, pdfError, content };
}

/** A fresh download link for an existing report (the old one stops working). */
export async function refreshReportLink(db: Db, reportId: string, origin: string, now: string, ttlSeconds = DAY) {
  const { token, hash } = newLinkToken();
  const expiresAt = new Date(Date.parse(now) + Math.min(Math.max(60, ttlSeconds), 7 * DAY) * 1000).toISOString();
  const { data, error } = await db.from("reports").update({ link_hash: hash, link_expires_at: expiresAt }).eq("id", reportId).select("id");
  if (error) throw new ReportError("write_failed", error.message);
  if (!data?.length) throw new ReportError("not_found", "That report isn't available.");
  return { ...reportLinks(origin, reportId, token), expiresAt };
}
