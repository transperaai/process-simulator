// Process history (issue #105, A40): the pure parts. A version is a published revision; its row on the History
// screen says when it went live, who published it, what changed, and (once simulated) its headline numbers.
// No React, no database.

import type { EngineModel, SimulationResult } from "@transpera-flow/engine";

/** How many versions are simulated without being asked, newest first; older ones wait for a click on Run. */
export const AUTO_RUN_VERSIONS = 10;
/** Replications per version: enough for a steady average and a range, quick enough to do ten in a few seconds. */
export const HISTORY_REPS = 20;
/** The same seed for every version, so a change between versions is the process changing, not the dice. */
export const HISTORY_SEED = 1;

const WEEKS_PER_MONTH = 52 / 12;
const WORKING_DAYS_PER_WEEK = 5;

/** What publishing changed, as the database's audit entry records it: ids of steps and edges. */
export interface RevisionChanges {
  steps: { added: string[]; removed: string[]; changed: string[] };
  edges: { added: string[]; removed: string[]; changed: string[] };
}

export type AuthorKind = "user" | "mcp" | "system";

/** One published version, as the History table lists it. */
export interface VersionMeta {
  revisionId: string;
  number: number;
  /** The version people are using now. */
  live: boolean;
  publishedAt: string | null;
  authorKind: AuthorKind | null;
  /** A person's name, when the workspace knows it. */
  authorName: string | null;
  changes: RevisionChanges | null;
}

/** "Claude (MCP)" for a publish through MCP, else the person's name. */
export function authorLabel(v: Pick<VersionMeta, "authorKind" | "authorName">): string {
  if (v.authorKind === "mcp") return "Claude (MCP)";
  if (v.authorKind === "system") return "System";
  if (v.authorName) return v.authorName;
  // A signed-in person the workspace has no name for, or a version that was there before anyone kept track.
  return v.authorKind === "user" ? "A team member" : "Imported";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What changed in a version, in plain words: "2 steps changed, 1 added; 3 connections changed". `first` is the
 * oldest version, which has nothing to be compared with.
 */
export function describeChanges(changes: RevisionChanges | null, first: boolean): string {
  if (!changes) return first ? "First version" : "Changes weren't recorded";
  const part = (what: [string, string], c: { added: unknown[]; removed: unknown[]; changed: unknown[] }) => {
    const bits: string[] = [];
    if (c.changed.length) bits.push(`${count(c.changed.length, what[0], what[1])} changed`);
    if (c.added.length) bits.push(`${c.added.length} added`);
    if (c.removed.length) bits.push(`${c.removed.length} removed`);
    return bits.join(", ");
  };
  const steps = part(["step", "steps"], changes.steps);
  const edges = part(["connection", "connections"], changes.edges);
  if (!steps && !edges) return "Nothing changed (published again as it was)";
  const text = [steps, edges].filter(Boolean).join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Reads the audit entry's changes jsonb, or null if it isn't that shape. */
export function parseChanges(value: unknown): RevisionChanges | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, Record<string, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  const one = (k: "steps" | "edges") => ({ added: list(v[k]?.added), removed: list(v[k]?.removed), changed: list(v[k]?.changed) });
  return { steps: one("steps"), edges: one("edges") };
}

/** A measure with its range: the average and the 10th to 90th percentile band. */
export interface Measure {
  mean: number;
  lo: number;
  hi: number;
}

/** The two headline numbers of a simulated version. */
export interface Headline {
  /** New wins per month. */
  winsPerMonth: Measure;
  /** Working days from lead to win (the average, with the typical-to-slow range). */
  leadToWinDays: Measure;
}

/** Wins per month and lead to win of one run, however long the run's horizon was. */
export function headlineOf(result: SimulationResult, model: Pick<EngineModel, "horizonWeeks" | "hoursPerWeek">): Headline {
  const perMonth = WEEKS_PER_MONTH / model.horizonWeeks;
  const won = result.kpi.won;
  const day = model.hoursPerWeek / WORKING_DAYS_PER_WEEK;
  const c = result.kpi.cycle;
  return {
    winsPerMonth: { mean: won.mean * perMonth, lo: won.p10 * perMonth, hi: won.p90 * perMonth },
    // The cycle's spread is reported as the median and the 90th percentile: the band runs from a typical lead to a slow one.
    leadToWinDays: { mean: c.mean / day, lo: Math.min(c.mean, c.p50) / day, hi: Math.max(c.mean, c.p90) / day },
  };
}

/** The versions to simulate without being asked: the newest `cap`, newest first. */
export function autoRunIds(versions: readonly Pick<VersionMeta, "revisionId" | "number">[], cap = AUTO_RUN_VERSIONS): string[] {
  return [...versions].sort((a, b) => b.number - a.number).slice(0, cap).map((v) => v.revisionId);
}

/** How a version's numbers stand. */
export type RunEntry = { status: "running" } | { status: "done"; headline: Headline } | { status: "error"; message: string };

/** The version names for a chart's axis, oldest first: v1, v2, ... */
export const versionLabel = (n: number) => `v${n}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "29 Sep 2026", in UTC so the server and the browser print the same day (and the same month name, whatever the locale data). */
export function formatPublished(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
