import type { NextRequest } from "next/server";
import { demoProblemsPage, demoReportContent } from "@/lib/report/demo";
import { htmlToPdf } from "@/lib/report/pdf";
import { renderReportHtml } from "@/lib/report/render";

// The demo's PDF (issue #28): the Northbeam report printed by headless
// Chromium in this function (docs/PRD.md §9, §10), nothing stored. Narration
// and edits as on the printable route (#29).
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  const built = await demoReportContent(request.nextUrl.searchParams);
  if (!built.ok) return demoProblemsPage(built.problems);
  const { content } = built;
  const pdf = await htmlToPdf(renderReportHtml(content));
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Northbeam - ${content.process.name.replace(/[^\w\s-]+/g, "")} report.pdf"`,
      "cache-control": "no-store",
    },
  });
}
