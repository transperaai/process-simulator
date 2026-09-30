// Company-model tools (docs/PRD.md §7.1, §7.1c, decision D19; issue #25):
// set_company, upsert_service, upsert_person, upsert_client and set_demand
// create suggestions and change nothing else; list_suggestions reads them.
// A person accepts or rejects each one on the app's Suggestions page. The
// database backs this up: an API-token request can't write the company-model
// tables or review suggestions (migration 20261015000000_suggestions.sql).
// Like every tool, these act as the token's user under RLS
// (docs/adr/0002-mcp-acts-as-user-via-pre-request.md).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  describeSuggestion,
  loadCompanyModel,
  loadSuggestions,
  SUGGESTION_ROW_COLUMNS,
  type CompanyModel,
  type EvidenceCitation,
  type Json,
  type SuggestionRow,
} from "@transpera-flow/db";
import { resolveWorkspace, type ToolContext, type WorkspaceRef } from "./context";
import { runTool, ToolError } from "./result";
import {
  buildClientSuggestion,
  buildCompanySuggestion,
  buildDemandSuggestions,
  buildPersonSuggestion,
  buildServiceSuggestion,
  type Built,
} from "./suggesting";

export const SUGGESTION_TOOL_NAMES = ["set_company", "upsert_service", "upsert_person", "upsert_client", "set_demand", "list_suggestions"] as const;

const workspaceArg = z.string().optional().describe("Workspace id, slug or name. Defaults to the active workspace (set_active_workspace).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date (YYYY-MM-DD)");
const share = z.number().min(0).max(1);

const evidenceArg = z
  .array(
    z
      .object({
        source_id: z.string().uuid().describe("A source's id (add_source, or the Sources page)"),
        speaker: z.string().max(200).optional(),
        quote: z.string().trim().min(1).max(2000).describe("The speaker's words, verbatim"),
        timestamp: z.string().max(50).optional().describe("Where in the source, e.g. 00:12:40"),
        value: z.number().optional().describe("The number they stated, in the field's units"),
      })
      .strict(),
  )
  .max(20)
  .optional()
  .describe("Citations for the values: who said what, and where. Accepted values keep them as provenance.");
const noteArg = z.string().max(2000).optional().describe("Your reasoning, shown to the reviewer and kept with the value.");
const nameRefArg = (kind: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(`The ${kind}'s exact name or id to update, or a new name to add one. A name that only partly matches is refused with the candidates.`);
const createArg = z.boolean().optional().describe("Add a new row even though the name partly matches existing ones.");
const renameArg = z.string().trim().min(1).max(200).optional().describe("A new name for an existing row.");

const companySettings = {
  hours_per_week: z.number().positive().max(168).optional(),
  working_days: z.number().int().min(1).max(7).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "an ISO currency code such as GBP").optional(),
  fy_start: z.string().max(20).optional().describe("Month the financial year starts, e.g. April"),
  overhead_monthly: z.number().min(0).optional(),
  target_margin: share.optional(),
  overtime_cap: share.optional().describe("Overtime allowed as a share of capacity (0.1 = 10%)"),
  availability_floor: share.optional().describe("Minimum share of a week left for pipeline work"),
  utilisation_threshold: share.optional(),
  capacity_factor_enabled: z.boolean().optional(),
  horizon_weeks: z.number().int().min(1).max(104).optional(),
};

function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** Evidence must cite this workspace's sources. */
async function checkSources(ctx: ToolContext, ws: WorkspaceRef, evidence: EvidenceCitation[]): Promise<void> {
  const ids = [...new Set(evidence.map((e) => e.source_id))];
  if (!ids.length) return;
  const found = check(await ctx.db.from("sources").select("id").eq("workspace_id", ws.id).in("id", ids)).map((r) => r.id);
  const missing = ids.filter((id) => !found.includes(id));
  if (missing.length) throw new ToolError("not_found", `No source in '${ws.name}' has the id ${missing.join(", ")}; add it with add_source first`);
}

const headlineOf = (s: SuggestionRow, model: CompanyModel) => {
  const v = describeSuggestion(s, model);
  return { subject: v.subject, headline: v.headline, changes: v.changes, missing: v.missing };
};

/** Store the suggestions a builder made, as the user, and describe them. */
async function store(ctx: ToolContext, ws: WorkspaceRef, model: CompanyModel, built: Built) {
  await checkSources(ctx, ws, built.proposals.flatMap((p) => p.evidence));
  let rows: SuggestionRow[] = [];
  if (built.proposals.length) {
    const { data, error } = await ctx.db
      .from("suggestions")
      .insert(
        built.proposals.map((p) => ({
          workspace_id: ws.id,
          target_table: p.target_table,
          target_id: p.target_id,
          patch: p.patch as unknown as Json,
          evidence: p.evidence as unknown as Json,
          note: p.note,
        })),
      )
      .select(SUGGESTION_ROW_COLUMNS);
    if (error) {
      if (error.code === "42501") throw new ToolError("forbidden", "You don't have permission to suggest changes in this workspace (editors and owners can).");
      if (error.code === "23514") throw new ToolError("invalid_input", `Some of those values aren't allowed: ${error.message}`);
      throw new ToolError("write_failed", `Couldn't save the suggestion: ${error.message}`);
    }
    rows = data as unknown as SuggestionRow[];
  }
  return {
    workspace: { id: ws.id, name: ws.name },
    suggestions: rows.map((r) => ({ id: r.id, status: r.status, target_table: r.target_table, target_id: r.target_id, ...headlineOf(r, model) })),
    unchanged: built.unchanged,
    message: rows.length
      ? `Created ${rows.length} suggestion${rows.length === 1 ? "" : "s"}. Nothing changes until someone accepts ${rows.length === 1 ? "it" : "them"} on the workspace's Suggestions page.`
      : "Nothing to suggest: the model already has those values.",
  };
}

async function load(ctx: ToolContext, workspace: string | undefined, assumptions: string[]) {
  const ws = await resolveWorkspace(ctx, workspace, assumptions);
  return { ws, model: await loadCompanyModel(ctx.db, ws) };
}

export function registerSuggestionTools(server: McpServer, ctx: ToolContext): void {
  const suggestionNote = " Creates a suggestion for a person to accept or reject in the app; changes no live data.";

  server.registerTool(
    "set_company",
    {
      title: "Suggest company settings",
      description: "Suggest changes to the company settings (working hours, currency, overhead, overtime cap, availability floor …)." + suggestionNote,
      inputSchema: { ...companySettings, evidence: evidenceArg, note: noteArg, workspace: workspaceArg },
    },
    ({ evidence, note, workspace, ...settings }) =>
      runTool(async (assumptions) => {
        if (!Object.values(settings).some((v) => v !== undefined)) throw new ToolError("invalid_input", "Give at least one setting to change");
        const { ws, model } = await load(ctx, workspace, assumptions);
        return store(ctx, ws, model, buildCompanySuggestion(model, settings, { evidence, note }));
      }),
  );

  server.registerTool(
    "upsert_service",
    {
      title: "Suggest a service",
      description: "Suggest a new service (engagement type) or changes to one: pricing, price, margin, tenure, churn and mix." + suggestionNote,
      inputSchema: {
        name: nameRefArg("service"),
        rename: renameArg,
        create: createArg,
        pricing_model: z.enum(["retainer", "one_off", "hourly"]).optional(),
        price: z.number().min(0).optional().describe("Monthly fee (retainer), whole fee (one-off) or hourly rate"),
        margin: share.optional().describe("Gross margin as a share of price"),
        tenure_months: z.number().min(0).optional(),
        churn_monthly_base: share.optional(),
        mix_share: z.number().min(0).optional().describe("Relative share of new work"),
        active: z.boolean().optional(),
        evidence: evidenceArg,
        note: noteArg,
        workspace: workspaceArg,
      },
    },
    ({ workspace, ...args }) =>
      runTool(async (assumptions) => {
        const { ws, model } = await load(ctx, workspace, assumptions);
        return store(ctx, ws, model, buildServiceSuggestion(model, args, assumptions));
      }),
  );

  server.registerTool(
    "upsert_person",
    {
      title: "Suggest a person",
      description:
        "Suggest a new person or changes to one: roles (the full set, by name), FTE, capacity, cost rate, dates and leave to add." + suggestionNote,
      inputSchema: {
        name: nameRefArg("person"),
        rename: renameArg,
        create: createArg,
        roles: z.array(z.string().min(1)).max(20).optional().describe("Every role they hold, by name or id (replaces their roles)"),
        fte: z.number().positive().max(1.5).optional(),
        capacity_hours_week: z.number().positive().max(168).nullable().optional().describe("Null: FTE × the workspace's hours a week"),
        cost_rate: z.number().min(0).nullable().optional().describe("Hourly cost"),
        email: z.string().email().nullable().optional(),
        start_date: date.nullable().optional(),
        end_date: date.nullable().optional(),
        active: z.boolean().optional(),
        leave: z
          .array(z.object({ start_date: date, end_date: date, note: z.string().max(200).optional() }).strict())
          .max(50)
          .optional()
          .describe("Leave periods to add (inclusive dates)"),
        evidence: evidenceArg,
        note: noteArg,
        workspace: workspaceArg,
      },
    },
    ({ workspace, ...args }) =>
      runTool(async (assumptions) => {
        for (const l of args.leave ?? []) if (l.end_date < l.start_date) throw new ToolError("invalid_input", "Leave ends before it starts");
        const { ws, model } = await load(ctx, workspace, assumptions);
        return store(ctx, ws, model, buildPersonSuggestion(model, args, assumptions));
      }),
  );

  server.registerTool(
    "upsert_client",
    {
      title: "Suggest a client",
      description:
        "Suggest a new client or changes to one: services (the full set, by name), MRR, start date, health and who looks after them per role." +
        suggestionNote,
      inputSchema: {
        name: nameRefArg("client"),
        rename: renameArg,
        create: createArg,
        services: z.array(z.string().min(1)).max(20).optional().describe("Every service they take, by name or id (replaces their services)"),
        mrr: z.number().min(0).optional().describe("Monthly recurring revenue"),
        start_date: date.nullable().optional(),
        health: z.number().min(0).max(100).nullable().optional().describe("0–100"),
        notes: z.string().max(2000).nullable().optional(),
        active: z.boolean().optional(),
        assignments: z
          .record(z.string(), z.string().nullable())
          .optional()
          .describe("Role → person, by name or id, e.g. {\"SEO specialist\": \"Sam Patel\"}; null clears the role"),
        evidence: evidenceArg,
        note: noteArg,
        workspace: workspaceArg,
      },
    },
    ({ workspace, ...args }) =>
      runTool(async (assumptions) => {
        const { ws, model } = await load(ctx, workspace, assumptions);
        return store(ctx, ws, model, buildClientSuggestion(model, args, assumptions));
      }),
  );

  server.registerTool(
    "set_demand",
    {
      title: "Suggest demand",
      description:
        "Suggest demand changes: lead sources (added or changed, by name), seasonality multipliers and monthly growth. Each change becomes its own suggestion." +
        suggestionNote,
      inputSchema: {
        lead_sources: z
          .array(
            z
              .object({
                name: nameRefArg("lead source"),
                rename: renameArg,
                create: createArg,
                volume_week: z.number().min(0).optional().describe("Leads a week"),
                conversion_to_qualified: share.optional().describe("Share that become qualified leads"),
                evidence: evidenceArg,
                note: noteArg,
              })
              .strict(),
          )
          .max(50)
          .optional(),
        seasonality: z
          .union([
            z.array(z.number().min(0).max(100)).length(12),
            z.array(z.object({ month: z.number().int().min(1).max(12), multiplier: z.number().min(0).max(100) }).strict()).min(1).max(12),
          ])
          .optional()
          .describe("Twelve monthly multipliers (January first), or [{month, multiplier}] for the months to change; 1 is no effect"),
        growth_monthly: z.number().gt(-1).max(10).optional().describe("Compound change in demand a month (0.02 = +2%)"),
        evidence: evidenceArg,
        note: noteArg,
        workspace: workspaceArg,
      },
    },
    ({ workspace, ...args }) =>
      runTool(async (assumptions) => {
        if (!args.lead_sources?.length && !args.seasonality && args.growth_monthly === undefined) {
          throw new ToolError("invalid_input", "Give lead_sources, seasonality or growth_monthly");
        }
        const { ws, model } = await load(ctx, workspace, assumptions);
        return store(ctx, ws, model, buildDemandSuggestions(model, args, assumptions));
      }),
  );

  server.registerTool(
    "list_suggestions",
    {
      title: "List suggestions",
      description: "Suggested company-model changes and whether a person has accepted or rejected them, newest first.",
      inputSchema: { status: z.enum(["pending", "accepted", "rejected"]).optional(), workspace: workspaceArg },
      annotations: { readOnlyHint: true },
    },
    ({ status, workspace }) =>
      runTool(async (assumptions) => {
        const { ws, model } = await load(ctx, workspace, assumptions);
        const rows = await loadSuggestions(ctx.db, ws.id, status);
        return {
          workspace: { id: ws.id, name: ws.name },
          suggestions: rows.map((r) => ({
            id: r.id,
            status: r.status,
            target_table: r.target_table,
            target_id: r.target_id,
            ...headlineOf(r, model),
            evidence: r.evidence,
            note: r.note,
            created_at: r.created_at,
            reviewed_at: r.reviewed_at,
            review_note: r.review_note,
          })),
        };
      }),
  );
}
