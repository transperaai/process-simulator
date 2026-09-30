// MCP `export_report` (docs/PRD.md §7.1; issue #28) runs the same pipeline as
// the Reports page, with the MCP request's Supabase client (the token's user,
// under RLS; docs/adr/0002-*).

import { ToolError, type ReportExporter } from "@transpera-flow/mcp";
import { REPORT_DEFAULT_REPS, parseSections } from "./options";
import { ReportError, generateReport, type PdfRenderer } from "./server";

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
        return {
          id: r.id,
          title: r.title,
          url: input.format === "json" ? r.jsonUrl : r.url,
          expires_at: r.expiresAt,
          run_id: r.runId,
          pdf: r.pdf,
          pdf_error: r.pdfError,
          included: r.content.included,
          omitted: r.content.omitted,
          excluded_scenarios: r.content.excludedScenarios.map((s) => ({ name: s.name, reason: s.reason })),
          summary: r.content.summary?.paragraphs ?? [],
        };
      } catch (err) {
        if (err instanceof ReportError) throw new ToolError(err.code, err.message);
        throw err;
      }
    },
  };
}
