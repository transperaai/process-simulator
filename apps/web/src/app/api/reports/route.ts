import { anthropicNarrator } from "@/lib/narration/anthropic";
import { parseReportRequest } from "@/lib/report/options";
import { ReportError, generateReport } from "@/lib/report/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Generate a report as the signed-in user (issue #28; docs/PRD.md §9): the
// run, comparisons, robustness checks, the stored content and the PDF from
// headless Chromium, in one Vercel function. Robustness is capped at 120 s
// in total, narration (when asked, #29) at 75 s, and the PDF takes a few
// seconds: inside the limit below.
export const maxDuration = 300;

const STATUS: Record<ReportError["code"], number> = {
  not_found: 404,
  forbidden: 403,
  invalid_model: 422,
  model_changed: 409,
  not_reproducible: 409,
  invalid_input: 400,
  write_failed: 500,
};

export async function POST(request: Request): Promise<Response> {
  if (!supabaseEnv()) return Response.json({ status: "error", message: "Supabase is not configured; try the demo report at /demo/report." }, { status: 503 });
  const parsed = parseReportRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ status: "error", message: parsed.message }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return Response.json({ status: "error", message: "Your session has ended. Sign in again." }, { status: 401 });
  const { data: process } = await supabase.from("processes").select("id, workspace_id").eq("id", parsed.value.processId).maybeSingle();
  if (!process) return Response.json({ status: "error", message: "That process isn't available." }, { status: 404 });
  try {
    const report = await generateReport(supabase, {
      ...parsed.value,
      workspaceId: process.workspace_id,
      origin: new URL(request.url).origin,
      generatedBy: typeof claims.claims.email === "string" ? claims.claims.email : null,
      now: new Date().toISOString(),
      // Narration (#29): on demand, server-side only; without a key the template prints and says why.
      narration: parsed.value.narrate ? { model: anthropicNarrator() } : null,
    });
    return Response.json({
      status: "ok",
      id: report.id,
      title: report.title,
      runId: report.runId,
      url: report.url,
      expiresAt: report.expiresAt,
      pdf: report.pdf,
      pdfError: report.pdfError,
      printUrl: report.printUrl,
      included: report.content.included,
      omitted: report.content.omitted,
      excludedScenarios: report.content.excludedScenarios,
      summary: report.content.summary
        ? { source: report.content.summary.source, fallbackReason: report.content.summary.narration?.fallbackReason ?? null, cached: report.narration?.cached ?? false }
        : null,
    });
  } catch (err) {
    if (err instanceof ReportError) return Response.json({ status: "error", code: err.code, message: err.message }, { status: STATUS[err.code] });
    // Anything else is a bug or an outage: log it for the function logs and say so, rather than an empty 500.
    console.error("[reports] POST /api/reports failed", err);
    return Response.json({ status: "error", code: "internal", message: "The report couldn't be generated because of a server error (the details are in the server log). Try again." }, { status: 500 });
  }
}
