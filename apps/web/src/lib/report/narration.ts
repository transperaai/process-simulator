// A report's executive summary after assembly (issue #29; docs/PRD.md §7.3,
// §8 screen 12 "edit the executive summary"): narrate it (checked number by
// number, cached per run), or replace it with a person's edit, which is
// checked the same way and recorded ("edited by …") in the provenance
// appendix. Used when generating (the builder, MCP `export_report`) and on a
// stored report (the report's summary page), which is then re-printed.

import type { Db, Json } from "@transpera-flow/db";
import { editCheck, reportNarrationInput } from "@/lib/narration/facts";
import { checkText, type NarrationModel } from "@/lib/narration/narrate";
import type { NumberProblem } from "@/lib/narration/numbers";
import { cachedNarration, recordEdit, summaryFromNarration, type StoredNarration } from "@/lib/narration/service";
import { withSummary } from "./assemble";
import { toByteaHex } from "./bytea";
import { REPORT_CONTENT_VERSION, type ReportContent } from "./content";
import { logPdfFailure, pdfFailureReason } from "./pdf-failure";
import { renderReportHtml } from "./render";
import type { PdfRenderer } from "./server";

export interface NarrateReportOptions {
  workspaceId: string;
  model: NarrationModel | null;
  regenerate?: boolean;
  now?: () => Date;
  budgetMs?: number;
}

/** The content with a narrated summary (or the template, with the reason it printed). Unchanged without a summary section or a run id. */
export async function narrateReportContent(
  db: Db,
  content: ReportContent,
  opts: NarrateReportOptions,
): Promise<{ content: ReportContent; narration: StoredNarration | null }> {
  if (!content.summary || !content.run.id) return { content, narration: null };
  const narration = await cachedNarration(db, {
    workspaceId: opts.workspaceId,
    targetId: content.run.id,
    input: reportNarrationInput(content),
    model: opts.model,
    ...(opts.regenerate ? { regenerate: true } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.budgetMs ? { budgetMs: opts.budgetMs } : {}),
  });
  return { content: withSummary(content, summaryFromNarration(narration)), narration };
}

export type SummaryEdit = { ok: true; content: ReportContent } | { ok: false; problems: NumberProblem[] };

/** Clean up pasted text: paragraphs split on blank lines, trimmed, empties dropped. */
export function paragraphsFrom(input: string | readonly string[]): string[] {
  const list = typeof input === "string" ? input.split(/\n\s*\n/) : input.flatMap((p) => p.split(/\n\s*\n/));
  return list.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** A person's edit of the summary, checked against the report's figures; recorded as edited by `editor`. */
export function editSummary(content: ReportContent, paragraphs: readonly string[], editor: string, at: string): SummaryEdit {
  if (!content.summary) return { ok: false, problems: [{ text: "(the report)", reason: "it has no executive summary section" }] };
  const clean = paragraphsFrom(paragraphs);
  const check = checkText(clean, editCheck(reportNarrationInput(content)));
  if (!check.ok) return { ok: false, problems: check.problems };
  const prior = content.summary;
  const narration = prior.narration && prior.source === "narration" ? { ...prior.narration, checked: check.numbers.length } : (prior.narration ?? null);
  return { ok: true, content: withSummary(content, { ...prior, paragraphs: clean, editedBy: editor, editedAt: at, narration }) };
}

/** A stored report's content, as the caller may read it (RLS: editors). */
export async function loadReportContent(db: Db, reportId: string): Promise<{ id: string; workspaceId: string; content: ReportContent; hasPdf: boolean } | null> {
  const { data, error } = await db.from("reports").select("id, workspace_id, content, pdf_generated_at").eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const content = data.content as unknown as ReportContent;
  if (content?.version !== REPORT_CONTENT_VERSION) return null;
  return { id: data.id, workspaceId: data.workspace_id, content, hasPdf: Boolean(data.pdf_generated_at) };
}

/** Store new content on a report and re-print its PDF. Returns the print error, if any (the printable page still works). */
export async function storeReportContent(db: Db, reportId: string, content: ReportContent, renderPdf?: PdfRenderer): Promise<{ pdf: boolean; pdfError: string | null }> {
  const { error } = await db.from("reports").update({ content: content as unknown as Json, title: content.title }).eq("id", reportId);
  if (error) throw new Error(`Couldn't store the report: ${error.message}`);
  try {
    const render = renderPdf ?? (await import("./pdf")).htmlToPdf;
    const bytes = await render(renderReportHtml(content));
    const up = await db.from("reports").update({ pdf: toByteaHex(bytes), pdf_generated_at: new Date().toISOString() }).eq("id", reportId);
    if (up.error) throw new Error(up.error.message);
    return { pdf: true, pdfError: null };
  } catch (err) {
    logPdfFailure(`report ${reportId} (re-print)`, err);
    return { pdf: false, pdfError: pdfFailureReason(err) };
  }
}

/** Save a person's edit on a stored report: check it, record it (and on the narration it came from), re-print. */
export async function saveSummaryEdit(
  db: Db,
  reportId: string,
  paragraphs: readonly string[],
  editor: { id: string; name: string },
  { now = () => new Date(), renderPdf }: { now?: () => Date; renderPdf?: PdfRenderer } = {},
): Promise<{ ok: true; content: ReportContent; pdf: boolean; pdfError: string | null } | { ok: false; problems: NumberProblem[]; message?: string }> {
  const report = await loadReportContent(db, reportId);
  if (!report) return { ok: false, problems: [], message: "That report isn't available." };
  const at = now().toISOString();
  const edit = editSummary(report.content, paragraphs, editor.name, at);
  if (!edit.ok) return edit;
  const narrationId = edit.content.summary?.source === "narration" ? edit.content.summary.narration?.id : null;
  if (narrationId) await recordEdit(db, narrationId, edit.content.summary!.paragraphs, editor, at);
  const printed = await storeReportContent(db, reportId, edit.content, renderPdf);
  return { ok: true, content: edit.content, ...printed };
}

/** Narrate a stored report's summary (on demand), store it and re-print. */
export async function narrateStoredReport(
  db: Db,
  reportId: string,
  opts: Omit<NarrateReportOptions, "workspaceId"> & { renderPdf?: PdfRenderer },
): Promise<{ ok: true; content: ReportContent; narration: StoredNarration | null; pdf: boolean; pdfError: string | null } | { ok: false; message: string }> {
  const report = await loadReportContent(db, reportId);
  if (!report) return { ok: false, message: "That report isn't available." };
  if (!report.content.summary) return { ok: false, message: "This report has no executive summary section." };
  if (!report.content.run.id) return { ok: false, message: "This report has no saved run to narrate." };
  const { content, narration } = await narrateReportContent(db, report.content, { ...opts, workspaceId: report.workspaceId });
  const printed = await storeReportContent(db, reportId, content, opts.renderPdf);
  return { ok: true, content, narration, ...printed };
}
