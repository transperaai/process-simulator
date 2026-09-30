// export_report (docs/PRD.md §7.1, §9; issue #28): the same report pipeline
// as the app's Reports page, run as the token's user. The tool resolves the
// workspace, process, scenarios and saved run by id or name; the web app
// supplies the pipeline itself (content assembly, storage, Chromium), since
// the renderer lives there. It returns a signed URL: a download link that
// works without signing in until it expires.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadRuns, loadScenarios, type Db } from "@transpera-flow/db";
import { matchNamed } from "./analysis";
import { resolveProcess, resolveWorkspace, type ToolContext } from "./context";
import { runTool, ToolError } from "./result";

export const REPORT_TOOL_NAMES = ["export_report"] as const;

/** The report sections, in print order (apps/web/src/lib/report/content.ts). */
export const REPORT_SECTION_IDS = [
  "cover",
  "summary",
  "company_map",
  "process_maps",
  "clients",
  "issues",
  "scenarios",
  "utilisation",
  "robustness",
  "appendix",
  "methodology",
] as const;

export interface ReportExportInput {
  db: Db;
  workspaceId: string;
  processId: string;
  format: "pdf" | "json";
  scenarioIds: string[];
  /** Null: every section. */
  sections: string[] | null;
  /** A saved run to report on; null makes a new one. */
  runId: string | null;
  /** Replications for a new run; null: the report default. */
  reps: number | null;
}

export interface ReportExportResult {
  id: string;
  title: string;
  /** The signed URL: the PDF, or the content as JSON for `format: json`. */
  url: string;
  expires_at: string;
  run_id: string;
  pdf: boolean;
  pdf_error: string | null;
  included: string[];
  omitted: { section: string; reason: string }[];
  excluded_scenarios: { name: string; reason: string }[];
  /** The executive summary's paragraphs (templated text). */
  summary: string[];
}

/** Runs the report pipeline; throws a ToolError for problems the caller can act on. */
export interface ReportExporter {
  exportReport(input: ReportExportInput): Promise<ReportExportResult>;
}

const MAX_SCENARIOS = 6;

export function registerReportTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "export_report",
    {
      title: "Export report",
      description:
        "Generate the handover report of a process (default: the workspace's pipeline, with its servicing processes) and return a signed URL " +
        "that opens it without signing in for 24 hours. format 'pdf' is the printed report; 'json' is every number and sentence in it. " +
        "Numbers come from one run (a new one of the live model, saved with the report, unless `run` names a saved run whose model is unchanged). " +
        "Robustness is checked automatically for each scenario compared (reusing cached checks). Text is templated, never a language model. " +
        "Can take a minute or two with several scenarios.",
      inputSchema: {
        format: z.enum(["pdf", "json"]).describe("'pdf' (default) or 'json'.").optional(),
        scenarios: z
          .array(z.string().min(1))
          .max(MAX_SCENARIOS)
          .optional()
          .describe("Saved scenarios to compare (ids or names), in order. Omitted: none."),
        sections: z
          .array(z.enum(REPORT_SECTION_IDS))
          .optional()
          .describe(`Sections to include (the cover always is). Omitted: all of ${REPORT_SECTION_IDS.join(", ")}.`),
        run: z.string().optional().describe("A saved run (id or name) to report on. Omitted: a new run of the live model."),
        reps: z.number().int().min(1).max(500).optional().describe("Replications for a new run (default 200)."),
        process: z.string().optional().describe("Process id or name. Defaults to the workspace's only pipeline."),
        workspace: z.string().optional().describe("Workspace id, slug or name. Defaults to the active workspace (set_active_workspace)."),
      },
    },
    (args) =>
      runTool(async (assumptions) => {
        if (!ctx.reports) throw new ToolError("unavailable", "Report export isn't available on this server.");
        const ws = await resolveWorkspace(ctx, args.workspace, assumptions);
        const proc = await resolveProcess(ctx, ws, args.process, assumptions);
        const all = args.scenarios?.length ? await loadScenarios(ctx.db, ws.id) : [];
        const scenarios = (args.scenarios ?? []).map((ref) => matchNamed(all, ref, "saved scenario", ` in '${ws.name}'`));
        const run = args.run ? matchNamed(await loadRuns(ctx.db, ws.id), args.run, "saved run", ` in '${ws.name}'`) : null;
        const format = args.format ?? "pdf";
        if (!args.format) assumptions.push("format defaulted to pdf.");
        if (!args.sections) assumptions.push("sections defaulted to all.");
        if (!run) assumptions.push(`A new run of the live model is made and saved with the report${args.reps ? "" : " (200 replications, seed 1)"}.`);
        const result = await ctx.reports.exportReport({
          db: ctx.db,
          workspaceId: ws.id,
          processId: proc.id,
          format,
          scenarioIds: scenarios.map((s) => s.id),
          sections: args.sections ?? null,
          runId: run?.id ?? null,
          reps: args.reps ?? null,
        });
        return { workspace: { id: ws.id, name: ws.name }, process: { id: proc.id, name: proc.name }, format, ...result };
      }),
  );
}
