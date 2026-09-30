"use server";

import { headers } from "next/headers";
import { currentViewer } from "@/lib/access-data";
import { editCheck, reportNarrationInput } from "@/lib/narration/facts";
import { checkText } from "@/lib/narration/narrate";
import type { NumberProblem } from "@/lib/narration/numbers";
import type { ExecutiveSummary } from "@/lib/report/content";
import { loadReportContent, paragraphsFrom, saveSummaryEdit } from "@/lib/report/narration";
import { isUuid } from "@/lib/report/options";
import { ReportError, refreshReportLink } from "@/lib/report/server";
import { createClient } from "@/lib/supabase/server";

// A fresh download link for a stored report (issue #28): anyone holding it
// can open the PDF without signing in for 24 hours. Making one replaces the
// report's previous link. Editors, owners and agency admins (RLS).

export async function createReportLink(reportId: string): Promise<{ status: "ok"; url: string; expiresAt: string } | { status: "error"; message: string }> {
  if (!isUuid(reportId)) return { status: "error", message: "That report isn't available." };
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  try {
    const link = await refreshReportLink(await createClient(), reportId, origin, new Date().toISOString());
    return { status: "ok", url: link.url, expiresAt: link.expiresAt };
  } catch (err) {
    if (err instanceof ReportError) return { status: "error", message: err.message };
    throw err;
  }
}

// Editing the executive summary before export (issue #29; docs/PRD.md §7.3,
// §8 screen 12): the text is checked against the report's figures, like
// narration; a saved edit is recorded ("edited by …") in the provenance
// appendix and the PDF is re-printed.

export type SummaryActionResult =
  | { status: "ok"; summary: ExecutiveSummary; checked: number; pdfError?: string | null }
  | { status: "invalid"; problems: NumberProblem[] }
  | { status: "error"; message: string };

/** Check an edit without saving it. */
export async function checkReportSummary(reportId: string, text: string): Promise<SummaryActionResult> {
  if (!isUuid(reportId)) return { status: "error", message: "That report isn't available." };
  const report = await loadReportContent(await createClient(), reportId);
  if (!report?.content.summary) return { status: "error", message: "That report isn't available." };
  const check = checkText(paragraphsFrom(text), editCheck(reportNarrationInput(report.content)));
  return check.ok ? { status: "ok", summary: report.content.summary, checked: check.numbers.length } : { status: "invalid", problems: check.problems };
}

/** Save an edit: checked, recorded as edited by the signed-in user, and the PDF re-printed. */
export async function saveReportSummary(reportId: string, text: string): Promise<SummaryActionResult> {
  if (!isUuid(reportId)) return { status: "error", message: "That report isn't available." };
  const viewer = await currentViewer();
  if (!viewer) return { status: "error", message: "Your session has ended. Sign in again." };
  const result = await saveSummaryEdit(await createClient(), reportId, [text], { id: viewer.userId, name: viewer.email ?? viewer.name });
  if (!result.ok) return result.message ? { status: "error", message: result.message } : { status: "invalid", problems: result.problems };
  const summary = result.content.summary!;
  return { status: "ok", summary, checked: summary.narration?.checked ?? 0, pdfError: result.pdfError };
}
