import type { NextRequest } from "next/server";
import { buildDemoReport, demoRequest } from "@/lib/report/demo";
import { renderReportHtml } from "@/lib/report/render";

// The demo's report route (issue #28): the Northbeam report as the HTML
// document the PDF prints, for the browser's "Save as PDF".
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const { content } = buildDemoReport(demoRequest(params));
  const html = renderReportHtml(content, { toolbar: { pdfUrl: `/demo/report/pdf?${params.toString()}`, backUrl: "/demo/report" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
