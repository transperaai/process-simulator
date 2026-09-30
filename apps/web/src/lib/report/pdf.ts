// HTML to PDF with headless Chromium (docs/PRD.md §9, §10: "Vercel function
// with @sparticuz/chromium"; issue #28; docs/adr/0010-pdf-reports.md). On Vercel the
// Chromium build that ships in @sparticuz/chromium is unpacked into /tmp on
// the first call; locally (and in tests) `CHROMIUM_PATH` points at any
// Chrome or Chromium. The page's own print stylesheet (render.ts) sets the
// paper size, margins, page breaks and page numbers, so the browser's
// "Save as PDF" of the report route gives the same document. Failures come
// out as a PdfError naming the stage (pdf-failure.ts).

import type { Browser } from "puppeteer-core";
import { PdfError, pdfFailureReason } from "./pdf-failure";

/** Starts a browser; tests inject one that fails. */
export type BrowserLauncher = (executablePath?: string) => Promise<Browser>;

export interface PdfOptions {
  /** Give up waiting for web fonts after this long and print with the fallbacks (default 4 s). */
  fontTimeoutMs?: number;
  /** Overall cap on loading the page (default 20 s). */
  loadTimeoutMs?: number;
  /** A local Chrome or Chromium (default: `CHROMIUM_PATH`, else the serverless build). */
  executablePath?: string;
  /** How to start the browser (default: puppeteer-core with CHROMIUM_PATH or @sparticuz/chromium). */
  launch?: BrowserLauncher;
}

async function defaultLaunch(executablePath?: string): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  const local = executablePath || process.env.CHROMIUM_PATH;
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

/** Print a complete HTML document to an A4 PDF. Throws a PdfError. */
export async function htmlToPdf(html: string, { fontTimeoutMs = 4000, loadTimeoutMs = 20_000, executablePath, launch = defaultLaunch }: PdfOptions = {}): Promise<Uint8Array> {
  let browser: Browser;
  try {
    browser = await launch(executablePath);
  } catch (err) {
    throw new PdfError("launch", `Chromium couldn't start: ${pdfFailureReason(err)}`, { cause: err });
  }
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
  } catch (err) {
    throw new PdfError("print", `Chromium couldn't print the report: ${pdfFailureReason(err)}`, { cause: err });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
