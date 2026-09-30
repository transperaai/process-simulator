import type { NextRequest } from "next/server";
import { demoProblemsPage, demoReportContent } from "@/lib/report/demo";
import { renderReportHtml } from "@/lib/report/render";

// The demo's report route (issue #28): the Northbeam report as the HTML
// document the PDF prints, for the browser's "Save as PDF". With `narrate=1`
// the summary is narrated by the demo's stand-in writer, and `summary` is a
// visitor's edit, checked against the report's figures (#29).
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const built = await demoReportContent(params);
  if (!built.ok) return demoProblemsPage(built.problems);
  const html = renderReportHtml(built.content, { toolbar: { pdfUrl: `/demo/report/pdf?${params.toString()}`, backUrl: "/demo/report" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
