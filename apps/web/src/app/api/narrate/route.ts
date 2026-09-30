import { anthropicNarrator } from "@/lib/narration/anthropic";
import { explainRun } from "@/lib/narration/explain";
import type { StoredNarration } from "@/lib/narration/service";
import { narrateStoredReport } from "@/lib/report/narration";
import { isUuid } from "@/lib/report/options";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// POST /api/narrate (issue #29; docs/PRD.md §7.3): narration on demand, as
// the signed-in user under RLS, server-side only (the Anthropic key never
// leaves the server).
//   {target: "run", runId, regenerate?}       "explain this run"
//   {target: "report", reportId, regenerate?} a stored report's executive summary, then re-printed
// Every number is checked against the facts; a draft that fails twice, a
// timeout or an API error falls back to the templated text, and the reason
// comes back and is recorded in `narrations`.

// Two drafts at most (75 s together), plus re-printing a report's PDF.
export const maxDuration = 120;

const view = (n: StoredNarration) => ({
  source: n.source,
  paragraphs: n.paragraphs,
  validated: n.validated,
  fallback: n.fallback,
  reason: n.reason,
  cached: n.cached,
  model: n.model,
  checked: n.checked,
  retried: n.rejected.length > 0,
  at: n.at,
  editedBy: n.editedBy,
});

export async function POST(request: Request): Promise<Response> {
  if (!supabaseEnv()) return Response.json({ status: "error", message: "Supabase is not configured; the demo shows narration at /demo/report." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { target?: unknown; runId?: unknown; reportId?: unknown; regenerate?: unknown } | null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return Response.json({ status: "error", message: "Your session has ended. Sign in again." }, { status: 401 });
  const regenerate = body?.regenerate === true;

  if (body?.target === "run" && isUuid(body.runId)) {
    const result = await explainRun(supabase, body.runId, { model: anthropicNarrator(), regenerate });
    if (result.status === "error") return Response.json({ status: "error", message: result.message }, { status: result.code === "not_found" ? 404 : 403 });
    return Response.json({ status: "ok", narration: view(result.narration) });
  }
  if (body?.target === "report" && isUuid(body.reportId)) {
    const result = await narrateStoredReport(supabase, body.reportId, { model: anthropicNarrator(), regenerate });
    if (!result.ok) return Response.json({ status: "error", message: result.message }, { status: 404 });
    return Response.json({
      status: "ok",
      narration: result.narration ? view(result.narration) : null,
      summary: result.content.summary,
      pdf: result.pdf,
      pdfError: result.pdfError,
    });
  }
  return Response.json({ status: "error", message: "Say what to narrate: {target: 'run', runId} or {target: 'report', reportId}." }, { status: 400 });
}
