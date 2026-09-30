import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { buildDemoReport, DEMO_DEFAULT_SCENARIOS } from "@/lib/report/demo";
import { formatFigure } from "@/lib/report/format";
import { parseSections } from "@/lib/report/options";
import { htmlToPdf } from "@/lib/report/pdf";
import { renderReportHtml } from "@/lib/report/render";

// Smoke test of the server-side PDF (issue #28): headless Chromium prints the
// report's HTML to a PDF that parses, runs to several pages, and carries the
// key figures as text. Uses CHROMIUM_PATH, or Playwright's Chromium (CI
// installs it for the engine's browser tests).

function chromiumPath(): string | null {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const executablePath = chromiumPath();
if (process.env.CI && !executablePath) throw new Error("CI must run the PDF smoke test: install Chromium or set CHROMIUM_PATH");

describe.skipIf(!executablePath)("report PDF", () => {
  it("prints a parseable PDF with the key figures", async () => {
    const { content } = buildDemoReport({ sections: parseSections(undefined), scenarioIds: DEMO_DEFAULT_SCENARIOS.slice(0, 1), reps: 20, today: "2026-09-30T10:00:00.000Z" });
    const pdf = await htmlToPdf(renderReportHtml(content), { executablePath: executablePath!, fontTimeoutMs: 1000, loadTimeoutMs: 10_000 });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");

    const doc = await getDocumentProxy(pdf);
    expect(doc.numPages).toBeGreaterThanOrEqual(content.included.length);
    const { text } = await extractText(doc, { mergePages: true });
    const flat = text.replace(/\s+/g, " ");
    const ctx = { currency: content.run.currency, hoursPerWeek: content.run.hoursPerWeek };
    const won = content.kpis.find((k) => k.key === "won")!;
    const mrr = content.kpis.find((k) => k.key === "mrrAdded")!;
    expect(flat).toContain("Northbeam Digital");
    expect(flat).toContain("Executive summary");
    expect(flat).toContain(`wins avg ${formatFigure("count", won.stat.mean, ctx)}`);
    expect(flat).toContain(formatFigure("money", mrr.stat.mean, ctx));
    expect(flat).toContain("Hire a strategist");
    expect(flat).toContain(content.scenarios![0]!.robustness!.verdict.slice(0, 40));
    expect(flat).toMatch(/Page 1 of \d+/);
  }, 120_000);
});
