import type { NextRequest } from "next/server";
import { REPORT_CONTENT_VERSION, type ReportContent } from "@/lib/report/content";
import { isUuid } from "@/lib/report/options";
import { renderReportHtml } from "@/lib/report/render";
import { createClient } from "@/lib/supabase/server";

// The report route (issue #28; docs/PRD.md §9): the stored report as the same
// HTML document the server printed to PDF, with a toolbar for the browser's
// "Save as PDF" (the fallback when the server PDF isn't available). Read under
// RLS: editors, owners and agency admins.

export async function GET(_request: NextRequest, ctx: RouteContext<"/w/[slug]/reports/[id]/print">): Promise<Response> {
  const { slug, id } = await ctx.params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("reports").select("id, content, pdf_generated_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return new Response("Not found", { status: 404 });
  const content = data.content as unknown as ReportContent;
  if (content?.version !== REPORT_CONTENT_VERSION) return new Response("This report was stored in an older format and can't be shown.", { status: 410 });
  const html = renderReportHtml(content, {
    toolbar: { pdfUrl: data.pdf_generated_at ? `/api/reports/${data.id}/pdf` : null, backUrl: `/w/${encodeURIComponent(slug)}/reports` },
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
