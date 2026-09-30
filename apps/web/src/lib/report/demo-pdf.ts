// The demo's PDF (issue #28): the Northbeam report printed by headless
// Chromium, nothing stored. If Chromium fails, the response says why and links
// to the printable report with the same options (pdf-failure.ts), instead of
// an empty 500.

import { buildDemoReport, demoRequest } from "./demo";
import { logPdfFailure, pdfFailureResponse } from "./pdf-failure";
import { renderReportHtml } from "./render";
import type { PdfRenderer } from "./server";

export async function demoPdfResponse(
  request: { url: string; headers: Headers },
  { render, reps }: { render?: PdfRenderer; reps?: number } = {},
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const { content } = buildDemoReport({ ...demoRequest(params), ...(reps ? { reps } : {}) });
  let pdf: Uint8Array;
  try {
    pdf = await (render ?? (await import("./pdf")).htmlToPdf)(renderReportHtml(content));
  } catch (err) {
    logPdfFailure("/demo/report/pdf", err);
    const query = params.toString();
    return pdfFailureResponse(err, { printUrl: `/demo/report/print${query ? `?${query}` : ""}`, accept: request.headers.get("accept") });
  }
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Northbeam - ${content.process.name.replace(/[^\w\s-]+/g, "")} report.pdf"`,
      "cache-control": "no-store",
    },
  });
}
