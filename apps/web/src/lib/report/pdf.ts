// HTML to PDF with headless Chromium (docs/PRD.md §9, §10: "Vercel function
// with @sparticuz/chromium"; issue #28; docs/adr/0009-*). On Vercel the
// Chromium build that ships in @sparticuz/chromium is unpacked into /tmp on
// the first call; locally (and in tests) `CHROMIUM_PATH` points at any
// Chrome or Chromium. The page's own print stylesheet (render.ts) sets the
// paper size, margins, page breaks and page numbers, so the browser's
// "Save as PDF" of the report route gives the same document.

import type { Browser } from "puppeteer-core";

export interface PdfOptions {
  /** Give up waiting for web fonts after this long and print with the fallbacks (default 4 s). */
  fontTimeoutMs?: number;
  /** Overall cap on loading the page (default 20 s). */
  loadTimeoutMs?: number;
}

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  const local = process.env.CHROMIUM_PATH;
  if (local) {
    return puppeteer.launch({ executablePath: local, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] });
  }
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    headless: "shell",
  });
}

/** Print a complete HTML document to an A4 PDF. */
export async function htmlToPdf(html: string, { fontTimeoutMs = 4000, loadTimeoutMs = 20_000 }: PdfOptions = {}): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // Web fonts load from Google Fonts; if that's slow or blocked, the stack's fallbacks print instead.
    await page.setContent(html, { waitUntil: "load", timeout: loadTimeoutMs }).catch(async (err: unknown) => {
      if (!(err instanceof Error && /timeout/i.test(err.message))) throw err;
    });
    await Promise.race([page.evaluate(() => document.fonts.ready.then(() => undefined)), new Promise((r) => setTimeout(r, fontTimeoutMs))]);
    await page.emulateMediaType("print");
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, format: "A4", timeout: loadTimeoutMs });
    return new Uint8Array(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
