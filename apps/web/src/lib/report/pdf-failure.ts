// When headless Chromium can't print a report (issue #28;
// docs/adr/0010-pdf-reports.md): say why in one line, log the whole error so
// it shows in the Vercel function logs, and point at the printable report,
// which is the same document for the browser's "Save as PDF". Kept apart from
// pdf.ts so the routes can use it without loading puppeteer.

/** A failure in the Chromium step: `launch` (unpacking or starting it) or `print`. */
export class PdfError extends Error {
  constructor(
    readonly stage: "launch" | "print",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PdfError";
  }
}

const MAX_REASON = 300;

/** The first line of the error, short enough for a UI or a tool result. */
export function pdfFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line = raw.split("\n").find((l) => l.trim()) ?? "unknown error";
  const trimmed = line.trim();
  return trimmed.length > MAX_REASON ? `${trimmed.slice(0, MAX_REASON - 1)}…` : trimmed;
}

/** Log a PDF failure with its stack and cause, for the function logs. */
export function logPdfFailure(where: string, err: unknown): void {
  console.error(`[report-pdf] ${where}: the PDF couldn't be printed`, err);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The response when a PDF route can't print: a 500 that says why and links to
 * the printable report. A browser (Accept: text/html) gets a small page;
 * anything else gets JSON: `{status: "error", code: "pdf_failed", message, reason, printUrl}`.
 */
export function pdfFailureResponse(err: unknown, { printUrl, accept }: { printUrl: string; accept: string | null }): Response {
  const reason = pdfFailureReason(err);
  const message = `The PDF couldn't be generated (${reason}). Open the printable report and use your browser's Save as PDF instead.`;
  const headers = { "cache-control": "no-store" };
  if (accept?.includes("text/html")) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF unavailable</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#1f2328}code{font-size:.85em;word-break:break-word}a{font-weight:600}</style></head>
<body><h1>The PDF couldn't be generated</h1><p>The server's Chromium failed: <code>${esc(reason)}</code></p>
<p><a href="${esc(printUrl)}">Open the printable report</a> and use your browser's <em>Print → Save as PDF</em>; it is the same document.</p></body></html>`;
    return new Response(html, { status: 500, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }
  return Response.json({ status: "error", code: "pdf_failed", message, reason, printUrl }, { status: 500, headers });
}
