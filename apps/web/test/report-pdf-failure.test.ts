import type { Browser } from "puppeteer-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReportContent } from "@/lib/report/content";
import { buildDemoReport, DEMO_DEFAULT_SCENARIOS } from "@/lib/report/demo";
import { demoPdfResponse } from "@/lib/report/demo-pdf";
import { exportResult } from "@/lib/report/exporter";
import { parseSections } from "@/lib/report/options";
import { htmlToPdf } from "@/lib/report/pdf";
import { PdfError, pdfFailureReason } from "@/lib/report/pdf-failure";
import type { GeneratedReport } from "@/lib/report/server";

// When headless Chromium can't print (issue #28; production returned an empty
// 500 from /demo/report/pdf): the error names the stage and the reason, the
// PDF routes answer with a readable 500 pointing at the printable report, and
// MCP export_report tells the caller what to do instead.

const LAUNCH_FAILURE =
  'The input directory "/var/task/node_modules/.pnpm/@sparticuz+chromium@153.0.0/node_modules/@sparticuz/chromium/bin" does not exist.\n    at Chromium.executablePath (index.js:121:19)';
const failingLaunch = async (): Promise<Browser> => {
  throw new Error(LAUNCH_FAILURE);
};

afterEach(() => vi.restoreAllMocks());

describe("htmlToPdf failures", () => {
  it("wraps a launch failure as a PdfError with the first line of the reason", async () => {
    const err = await htmlToPdf("<p>x</p>", { launch: failingLaunch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfError);
    expect(err).toMatchObject({ stage: "launch" });
    expect((err as Error).message).toBe(`Chromium couldn't start: ${LAUNCH_FAILURE.split("\n")[0]}`);
    expect((err as Error).cause).toBeInstanceOf(Error);
  });

  it("wraps a print failure and still closes the browser", async () => {
    const close = vi.fn(async () => undefined);
    const browser = {
      newPage: async () => {
        throw new Error("Target closed");
      },
      close,
    } as unknown as Browser;
    const err = await htmlToPdf("<p>x</p>", { launch: async () => browser }).catch((e: unknown) => e);
    expect(err).toMatchObject({ stage: "print", message: "Chromium couldn't print the report: Target closed" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports a Chromium that isn't there as a launch failure (real puppeteer-core)", async () => {
    const err = await htmlToPdf("<p>x</p>", { executablePath: "/nonexistent/spdf-chrome" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ stage: "launch" });
    expect((err as Error).message).toMatch(/^Chromium couldn't start: .*spdf-chrome/);
  }, 30_000);

  it("keeps reasons to one short line", () => {
    expect(pdfFailureReason(new Error("\n  first line  \nsecond"))).toBe("first line");
    expect(pdfFailureReason("x".repeat(1000))).toHaveLength(300);
    expect(pdfFailureReason(new Error(""))).toBe("unknown error");
  });
});

describe("/demo/report/pdf when Chromium fails", () => {
  const url = "https://flow.test/demo/report/pdf?sections=cover&sections=summary&scenarios=" + DEMO_DEFAULT_SCENARIOS[0];
  const render = async (): Promise<Uint8Array> => {
    throw new PdfError("launch", "Chromium couldn't start: no bin");
  };

  it("answers a fetch with a JSON 500 that says why and links the printable report, and logs the error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await demoPdfResponse({ url, headers: new Headers({ accept: "application/json" }) }, { render, reps: 5 });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", code: "pdf_failed", reason: "Chromium couldn't start: no bin" });
    expect(body.message).toContain("Chromium couldn't start: no bin");
    expect(body.message).toContain("Save as PDF");
    expect(body.printUrl).toBe(`/demo/report/print?${new URL(url).searchParams.toString()}`);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("/demo/report/pdf"), expect.any(PdfError));
  }, 60_000);

  it("answers a browser with a page linking the printable report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await demoPdfResponse({ url, headers: new Headers({ accept: "text/html,application/xhtml+xml" }) }, { render, reps: 5 });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain("Chromium couldn&#39;t start: no bin");
    expect(html).toContain(`href="/demo/report/print?sections=cover&#38;sections=summary&#38;scenarios=`);
  }, 60_000);

  it("serves the PDF when printing works", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const res = await demoPdfResponse({ url, headers: new Headers() }, { render: async () => pdf, reps: 5 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  }, 60_000);
});

describe("export_report when the PDF fails", () => {
  let content: ReportContent;
  beforeAll(() => {
    content = buildDemoReport({ sections: parseSections(undefined), scenarioIds: [], reps: 5, today: "2026-09-30T10:00:00.000Z" }).content;
  }, 60_000);
  const report = (over: Partial<GeneratedReport>): GeneratedReport => ({
    id: "r1",
    title: "Report",
    runId: "run1",
    url: "https://flow.test/api/reports/r1/pdf?token=t",
    jsonUrl: "https://flow.test/api/reports/r1/pdf?token=t&format=json",
    expiresAt: "2026-10-01T10:00:00.000Z",
    pdf: true,
    pdfError: null,
    printUrl: "https://flow.test/w/northbeam/reports/r1/print",
    content,
    narration: null,
    ...over,
  });

  it("points at the printable report and the JSON, with the reason", () => {
    const out = exportResult(report({ pdf: false, pdfError: "Chromium couldn't start: no bin" }), "pdf");
    expect(out.pdf).toBe(false);
    expect(out.print_url).toBe("https://flow.test/w/northbeam/reports/r1/print");
    expect(out.pdf_fallback).toContain("Chromium couldn't start: no bin");
    expect(out.pdf_fallback).toContain("https://flow.test/w/northbeam/reports/r1/print");
    expect(out.pdf_fallback).toContain("format=json");
  });

  it("says nothing extra when the PDF printed or JSON was asked for", () => {
    expect(exportResult(report({}), "pdf").pdf_fallback).toBeNull();
    const json = exportResult(report({ pdf: false }), "json");
    expect(json.pdf_fallback).toBeNull();
    expect(json.url).toMatch(/format=json$/);
  });
});
