// The PDF report's content (issue #28; docs/PRD.md §9 "PDF", §7.3): every
// number and sentence the report shows, as one JSON value. It is assembled
// once, from a saved run, by `buildReportContent` (assemble.ts), stored with
// the report (`reports.content`), and rendered by `renderReportHtml`
// (render.ts) for both the server-side PDF and the browser's print fallback,
// so the two are the same document and re-opening a report never re-runs the
// engine. Numbers are kept raw (means and 10th–90th percentile ranges, as the
// engine returned them); the renderer formats them. Narration (#29) validates
// its text against this value and replaces `summary`.

import type { InitialState, IssueType, Rating, Stat } from "@transpera-flow/engine";

/** Bump when the shape changes, so old reports can still be read (or refused) knowingly. */
export const REPORT_CONTENT_VERSION = 1;

/** The report's sections, in the order they print (issue #28). */
export const REPORT_SECTIONS = [
  { id: "cover", label: "Cover", optional: false },
  { id: "summary", label: "Executive summary", optional: true },
  { id: "company_map", label: "Company map", optional: true },
  { id: "process_maps", label: "Process maps and bottlenecks", optional: true },
  { id: "clients", label: "Client health and retention", optional: true },
  { id: "issues", label: "Issues by rating", optional: true },
  { id: "scenarios", label: "Scenario comparisons", optional: true },
  { id: "utilisation", label: "Utilisation", optional: true },
  { id: "robustness", label: "Robustness", optional: true },
  { id: "appendix", label: "Assumptions, evidence and provenance", optional: true },
  { id: "methodology", label: "Methodology", optional: true },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]["id"];

export const SECTION_IDS: readonly ReportSectionId[] = REPORT_SECTIONS.map((s) => s.id);

export const sectionLabel = (id: ReportSectionId) => REPORT_SECTIONS.find((s) => s.id === id)!.label;

/** How a figure is formatted when printed. */
export type FigureFormat = "count" | "money" | "days" | "hours" | "percent";

/** A headline figure: the mean and its 10th–90th percentile range. */
export interface KpiFigure {
  key: string;
  label: string;
  format: FigureFormat;
  /** The mean, and the 10th–90th percentile band (for cycle time, `range: "p50_p90"`: the median and the P90 in p10/p90). */
  stat: Stat;
  range?: "p50_p90";
  /** What the figure means (docs/PRD.md §13). */
  definition: string;
}

export interface ReportRunInfo {
  /** The saved run (`runs.id`) the report was generated from; null on the demo. */
  id: string | null;
  name: string;
  seed: number;
  reps: number;
  /** The engine version the numbers came from. */
  engineVersion: string;
  /** Day the run starts (people's dates and leave are measured from it). */
  startDate: string;
  horizonWeeks: number;
  hoursPerWeek: number;
  currency: string;
  initialState: InitialState;
  /** The process revisions it ran. */
  revisions: { processId: string; name: string; number: number }[];
  /** When the run was saved; null when it was made for this report and not saved (the demo). */
  savedAt: string | null;
  /** "Cycle time" in days needs this; kept so the renderer needs nothing else. */
  cycle: { mean: number; p50: number; p90: number };
}

/** The executive summary: templated text, or narration checked number by number (#29). */
export interface ExecutiveSummary {
  source: "template" | "narration";
  paragraphs: string[];
  /** Who edited it before export (#29); shown in the provenance appendix. */
  editedBy: string | null;
  /** When it was last edited. */
  editedAt?: string | null;
  /** How narration was made, or why it wasn't used (#29); absent when nobody asked for narration. */
  narration?: SummaryNarration | null;
}

/** The narration behind a summary (docs/adr/0011-narration.md). */
export interface SummaryNarration {
  /** The cached `narrations` row, when stored. */
  id: string | null;
  /** The model that drafted it, e.g. "claude-opus-5-5"; the stand-in on the demo. */
  model: string;
  /** When the draft was made. */
  at: string;
  /** Numbers in the printed text, each matched to one of the report's figures. */
  checked: number;
  /** A first draft was rejected for figures not in the report and redrafted. */
  retried: boolean;
  /** Why the templated text printed instead (a rejected draft, the API unavailable), or null. */
  fallbackReason: string | null;
}

export interface MapNode {
  id: string;
  name: string;
  kind: "task" | "wait" | "decision" | "subprocess" | "start" | "end";
  outcome: "won" | "lost" | "done" | null;
  x: number;
  y: number;
  role: { name: string; color: string | null } | null;
  person: string | null;
  workHours: number;
  waitHours: number;
  rework: number;
  /** From the run; null for steps nobody works (starts, ends, pure decisions). */
  stats: { avgQueue: number; maxQueue: number; avgWaitHours: number; arrivals: number } | null;
  /** Number of the bottleneck callout on this step, if it has one. */
  callout: number | null;
  bottleneck: boolean;
  /** An estimate nobody has confirmed, or sources that disagree (docs/PRD.md §7.1b). */
  assumption: boolean;
  conflict: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  probability: number;
  tag: string | null;
  label: string | null;
}

export interface ProcessMapView {
  id: string;
  name: string;
  kind: "pipeline" | "servicing";
  revision: number;
  nodes: MapNode[];
  edges: MapEdge[];
  /** Numbered notes under the map, one per callout. */
  callouts: { n: number; stepId: string; text: string }[];
}

export interface CompanyMapView {
  processes: { id: string; name: string; kind: "pipeline" | "servicing"; steps: number; subject: boolean; busiestRole: { name: string; util: number } | null }[];
  /** Pipeline → servicing hand-offs: a won client starts receiving the servicing process. */
  handoffs: { from: string; to: string; label: string }[];
}

export interface BottleneckSection {
  /** Templated sentences from the engine's ranking (bottlenecks.ts). */
  text: string[];
  roles: { name: string; util: Stat; overThreshold: boolean }[];
  steps: { name: string; avgQueue: number; maxQueue: number; avgWaitHours: number }[];
  shadowPrice: { role: string; perQuarter: Stat; text: string; reps: number; complete: boolean } | null;
  threshold: number;
}

export interface UtilisationRow {
  id: string;
  name: string;
  color: string | null;
  util: Stat;
  pipeline: number;
  servicing: number;
  ongoing: number;
  overtime: number;
}

export interface UtilisationView {
  threshold: number;
  roles: UtilisationRow[];
  /** Per person (capacity, not performance: no ranking, in name order). */
  people: UtilisationRow[];
}

export interface ClientRowView {
  id: string;
  name: string;
  mrr: number;
  startHealth: number;
  health: Stat;
  trajectory: number[];
  churnMonthly: Stat;
  /** Share of replications in which it churned, and in which it ended at risk. */
  churned: number;
  atRisk: number;
  touchpoints: { onTime: number; late: number; missed: number };
}

export interface ClientsView {
  atRisk: Stat;
  churned: Stat;
  touchpoints: { onTime: Stat; late: Stat; missed: Stat } | null;
  /** Most at risk first. */
  clients: ClientRowView[];
}

export interface IssueView {
  title: string;
  type: IssueType;
  rating: Rating;
  /** "Open", "In progress", or "Detected" for a detection nobody has tracked yet. */
  status: string;
  source: "manual" | "detected" | "promoted";
  where: string | null;
  owner: string | null;
  evidence: string | null;
  /** The saved scenario that tests the fix, and whether this report compares it. */
  fix: { name: string; inReport: boolean } | null;
}

export interface IssuesView {
  groups: { rating: Rating; issues: IssueView[] }[];
  /** Closed issues (done or dismissed) left out. */
  closed: number;
}

export interface CompareRowView {
  label: string;
  baseline: string;
  baselineRange: string;
  scenario: string;
  scenarioRange: string;
  change: string;
  changeRange: string;
  tone: "good" | "bad" | null;
}

export interface RobustnessView {
  verdict: string;
  details: string[];
  sensitive: { label: string; effect: string; flips: boolean }[];
  conflicts: string[];
  complete: boolean;
  /** Jobs the check needed and how many came from the cache. */
  jobs: number;
  cached: number;
  signHolds: number;
}

export interface ScenarioView {
  id: string;
  name: string;
  description: string | null;
  /** The changes, in words ("Strategist: head-count +1"). */
  changes: string[];
  headline: string;
  details: string[];
  table: CompareRowView[];
  /** Utilisation per role on both sides (means and ranges). */
  roles: { name: string; color: string | null; baseline: Stat; scenario: Stat }[];
  bottleneck: { baseline: string | null; scenario: string | null };
  robustness: RobustnessView | null;
}

export interface AppendixView {
  /** Values nobody has confirmed or measured, with what they rest on. */
  assumptions: { where: string; parameter: string; value: string; status: "assumption" | "estimate" | "conflict"; note: string | null }[];
  /** What people said, value by value. */
  evidence: { where: string; parameter: string; quote: string; speaker: string | null; source: string; timestamp: string | null }[];
  /** Sources that disagree. */
  conflicts: { where: string; parameter: string; values: string; resolved: boolean }[];
  sources: { title: string; kind: string; speakers: string[]; recordedAt: string | null; citations: number }[];
  /** Company-model values and engine defaults that are estimates. */
  company: { parameter: string; value: string; source: string }[];
  /** Who produced what (the run, the text, edits). */
  provenance: string[];
}

export interface MethodologyView {
  paragraphs: string[];
}

export interface ReportBranding {
  /** Accent colour (#34 adds workspace branding); null: the default tokens. */
  accent: string | null;
  logoUrl: string | null;
}

export interface ReportContent {
  version: typeof REPORT_CONTENT_VERSION;
  /**
   * Names narration keeps from the language model (#29): they are replaced by
   * labels ("Client A", "Team member B") in what it is sent. Absent on reports
   * made before #29 (the utilisation and client tables are used instead).
   */
  names?: { people: string[]; clients: string[] };
  title: string;
  generatedAt: string;
  generatedBy: string | null;
  workspace: { id: string; name: string };
  branding: ReportBranding;
  process: { id: string; name: string; entityName: string };
  run: ReportRunInfo;
  /** What was asked for. */
  options: { sections: ReportSectionId[]; scenarioIds: string[] };
  /** Sections printed, in order. */
  included: ReportSectionId[];
  /** Sections asked for but left out, and why. */
  omitted: { section: ReportSectionId; reason: string }[];
  summary: ExecutiveSummary | null;
  kpis: KpiFigure[];
  companyMap: CompanyMapView | null;
  processMaps: ProcessMapView[] | null;
  bottlenecks: BottleneckSection | null;
  clients: ClientsView | null;
  issues: IssuesView | null;
  scenarios: ScenarioView[] | null;
  /** Scenarios asked for that can't run (they need attention), and why. */
  excludedScenarios: { id: string; name: string; reason: string }[];
  utilisation: UtilisationView | null;
  appendix: AppendixView | null;
  methodology: MethodologyView | null;
}
