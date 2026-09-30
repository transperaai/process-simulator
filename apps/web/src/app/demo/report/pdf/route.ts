import type { NextRequest } from "next/server";
import { buildDemoReport, demoRequest } from "@/lib/report/demo";
import { htmlToPdf } from "@/lib/report/pdf";
import { renderReportHtml } from "@/lib/report/render";

// The demo's PDF (issue #28): the Northbeam report printed by headless
// Chromium in this function (docs/PRD.md §9, §10), nothing stored.
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  const { content } = buildDemoReport(demoRequest(request.nextUrl.searchParams));
  const pdf = await htmlToPdf(renderReportHtml(content));
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Northbeam - ${content.process.name.replace(/[^\w\s-]+/g, "")} report.pdf"`,
      "cache-control": "no-store",
    },
  });
}
