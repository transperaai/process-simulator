// What someone asks a report for (issue #28: "Sections and scenarios can be
// chosen before generating"), checked the same way from the report builder,
// the API route, the demo and MCP `export_report`.

import { SECTION_IDS, type ReportSectionId } from "./content";

/** Replications a report runs by default (docs/PRD.md §4.1: "configurable to 200 for reports"). */
export const REPORT_DEFAULT_REPS = 200;
export const REPORT_MAX_REPS = 500;
export const REPORT_MAX_SCENARIOS = 6;
/** Time for every robustness check of one report together (the route allows 300 s). */
export const REPORT_ROBUSTNESS_BUDGET_MS = 120_000;
export const REPORT_SHADOW_PRICE_BUDGET_MS = 15_000;

export interface ReportRequest {
  processId: string;
  /** A saved run to report on; null: a new run is made (and saved) for the report. */
  runId: string | null;
  reps: number;
  sections: ReportSectionId[];
  scenarioIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Section ids from a list (unknown ones dropped); nothing listed means every section. */
export function parseSections(value: unknown): ReportSectionId[] {
  const list = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : null;
  if (!list) return [...SECTION_IDS];
  const asked = new Set(list.map((v) => String(v).trim()));
  return SECTION_IDS.filter((id) => id === "cover" || asked.has(id));
}

/** The request, checked, or why it isn't valid. */
export function parseReportRequest(input: unknown): { ok: true; value: ReportRequest } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Nothing to generate." };
  const i = input as Record<string, unknown>;
  if (!isUuid(i.processId)) return { ok: false, message: "Choose a process to report on." };
  if (i.runId !== undefined && i.runId !== null && !isUuid(i.runId)) return { ok: false, message: "That saved run isn't valid." };
  const reps = i.reps === undefined || i.reps === null ? REPORT_DEFAULT_REPS : Number(i.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > REPORT_MAX_REPS) return { ok: false, message: `Replications must be a whole number from 1 to ${REPORT_MAX_REPS}.` };
  const scenarioIds = Array.isArray(i.scenarioIds) ? [...new Set(i.scenarioIds)] : [];
  if (!scenarioIds.every(isUuid)) return { ok: false, message: "Some of those scenarios aren't valid." };
  if (scenarioIds.length > REPORT_MAX_SCENARIOS) return { ok: false, message: `Choose at most ${REPORT_MAX_SCENARIOS} scenarios.` };
  return {
    ok: true,
    value: { processId: i.processId, runId: (i.runId as string | null | undefined) ?? null, reps, sections: parseSections(i.sections), scenarioIds: scenarioIds as string[] },
  };
}
