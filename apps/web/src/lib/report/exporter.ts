// MCP `export_report` (docs/PRD.md §7.1; issue #28) runs the same pipeline as
// the Reports page, with the MCP request's Supabase client (the token's user,
// under RLS; docs/adr/0002-*).

import { ToolError, type ReportExporter, type ReportExportResult } from "@transpera-flow/mcp";
import { REPORT_DEFAULT_REPS, parseSections } from "./options";
import { ReportError, generateReport, type GeneratedReport, type PdfRenderer } from "./server";

/** The tool's result. When the PDF couldn't be printed it says so and points at the printable report and the JSON. */
export function exportResult(r: GeneratedReport, format: "pdf" | "json"): ReportExportResult {
  const pdfFailed = format === "pdf" && !r.pdf;
  return {
    id: r.id,
    title: r.title,
    url: format === "json" ? r.jsonUrl : r.url,
    expires_at: r.expiresAt,
    run_id: r.runId,
    pdf: r.pdf,
    pdf_error: r.pdfError,
    print_url: r.printUrl,
    pdf_fallback: pdfFailed
      ? `The report was generated and stored, but the server couldn't print the PDF (${r.pdfError ?? "unknown error"}), so the PDF link has nothing to serve. ` +
        `Open ${r.printUrl} while signed in and use Print → Save as PDF (the same document), or share ${r.jsonUrl} for the content as JSON.`
      : null,
    included: r.content.included,
    omitted: r.content.omitted,
    excluded_scenarios: r.content.excludedScenarios.map((s) => ({ name: s.name, reason: s.reason })),
    summary: r.content.summary?.paragraphs ?? [],
  };
}

export function reportExporter(origin: string, { now = () => new Date(), renderPdf }: { now?: () => Date; renderPdf?: PdfRenderer } = {}): ReportExporter {
  return {
    async exportReport(input) {
      try {
        const r = await generateReport(
          input.db,
          {
            workspaceId: input.workspaceId,
            processId: input.processId,
            runId: input.runId,
            reps: input.reps ?? REPORT_DEFAULT_REPS,
            sections: parseSections(input.sections ?? undefined),
            scenarioIds: input.scenarioIds,
            pdf: input.format === "pdf",
            origin,
            generatedBy: "Claude via MCP export_report",
            now: now().toISOString(),
          },
          renderPdf,
        );
        return exportResult(r, input.format);
      } catch (err) {
        if (err instanceof ReportError) throw new ToolError(err.code, err.message);
        throw err;
      }
    },
  };
}
