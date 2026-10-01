// What narration is given, and what it is checked against (issue #29;
// docs/PRD.md §7.3, D15; docs/adr/0011-narration.md). For "explain this run":
// a saved run's headline results.
//
// Privacy: only what the text needs goes to the model. No workspace name,
// people or client names (they become "Team member A", "Client B", mapped
// back after the check), no evidence quotes, sources, issue titles or
// per-person figures.
//
// The check context holds every figure in that payload, read with the same
// tokenizer the check uses (so "£4.2k" in the payload is known to £100), plus
// the raw means and range ends behind them (so "£33,005" is accepted too).

import { createHash } from "node:crypto";
import type { RunResults } from "@transpera-flow/db";
import type { Stat } from "@transpera-flow/engine";
import { formatDays, formatHours, formatNumber, formatPercent, formatWholeCurrency } from "@/lib/format";
import { factsFromText, type CheckContext, type Fact, type NumberKind } from "./numbers";

export type NarrationPurpose = "explain";

export interface NarrationInput {
  purpose: NarrationPurpose;
  /** What the model is sent (names already replaced by labels). */
  payload: Record<string, unknown>;
  /** What the model's text is checked against (its names are the labels). */
  check: CheckContext;
  /** Real name → label, for the payload; the model's text is mapped back. */
  aliases: { name: string; label: string }[];
  /** The templated text: the fallback (real names). */
  template: string[];
  /** SHA-256 of the payload and prompt version: the cache key. */
  hash: string;
}

/** Bump when the payload or the prompt changes, so cached narrations are redrafted. */
export const NARRATION_PROMPT_VERSION = 1;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Labels back to names, for the text that prints. */
export function restoreNames(text: string, aliases: readonly { name: string; label: string }[]): string {
  // Longest labels first ("Client AB" before "Client A"), bounded by a non-letter.
  let out = text;
  for (const a of [...aliases].sort((x, y) => y.label.length - x.label.length)) {
    out = out.replace(new RegExp(`${escapeRe(a.label)}(?![A-Za-z])`, "g"), a.name);
  }
  return out;
}

function strings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "number") out.push([path, String(value)]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
}

function hashOf(purpose: NarrationPurpose, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({ v: NARRATION_PROMPT_VERSION, purpose, payload })).digest("hex");
}

/** The raw figures behind a stat, in the kind's units (shares as %). */
export function statFacts(key: string, kind: NumberKind, s: Stat, out: Fact[]) {
  const scale = kind === "percent" ? 100 : 1;
  out.push({ key: `${key}.mean`, kind, value: s.mean * scale, step: 0 });
  out.push({ key: `${key}.p10`, kind, value: s.p10 * scale, step: 0 });
  out.push({ key: `${key}.p90`, kind, value: s.p90 * scale, step: 0 });
}

export function context(payload: Record<string, unknown>, raw: Fact[], dates: string[], names: string[], currency: string, hoursPerWeek: number): CheckContext {
  const texts: [string, string][] = [];
  strings(payload, "", texts);
  const facts = [...raw];
  const allDates = new Set(dates);
  for (const [key, text] of texts) {
    const read = factsFromText(key, text, names);
    facts.push(...read.facts);
    read.dates.forEach((d) => allDates.add(d));
  }
  return { facts, dates: [...allDates], names, currency, hoursPerDay: hoursPerWeek / 5 };
}

/** The check for text a person wrote (an edit): the same figures, with real names as well as labels. */
export function editCheck(input: NarrationInput): CheckContext {
  return { ...input.check, names: [...input.check.names, ...input.aliases.map((a) => a.name)] };
}

/** A saved run's results in words: the "explain this run" fallback. */
export function runTemplate(r: RunResults, processName: string): string[] {
  const money = (v: number) => formatWholeCurrency(v, r.currency);
  const range = (s: Stat, f: (v: number) => string) => (f(s.p10) === f(s.p90) ? `range ${f(s.p10)}` : `range ${f(s.p10)}–${f(s.p90)}`);
  const count = (s: Stat) => `avg ${formatNumber(s.mean, 1)} (${range(s, (v) => formatNumber(v, 0))})`;
  const paragraphs = [
    `Over ${r.horizon_weeks} weeks, ${processName} wins ${count(r.won)} and loses ${count(r.lost)}, across ${r.reps} replications. ` +
      `An item takes avg ${formatDays(r.cycle.mean, r.hours_per_week)} from arrival to an outcome (median ${formatDays(r.cycle.p50, r.hours_per_week)}, P90 ${formatDays(r.cycle.p90, r.hours_per_week)}).`,
    `New work adds avg ${money(r.mrr_added.mean)} in new MRR (${range(r.mrr_added, money)}), and the business bills avg ${money(r.billed.mean)} (${range(r.billed, money)}).` +
      (r.overtime_hours.mean > 0 ? ` Overtime comes to avg ${formatHours(r.overtime_hours.mean)} (${range(r.overtime_hours, formatHours)}).` : ""),
  ];
  if (r.bottleneck) {
    paragraphs.push(
      `${r.bottleneck.role} is the busiest role at avg ${formatPercent(r.bottleneck.util.mean)} utilised (${range(r.bottleneck.util, formatPercent)}), so it limits how much work gets through.`,
    );
  }
  return paragraphs;
}

/**
 * A run's headline results as the model reads them (each an average with its range, as the report prints it), and
 * the raw figures behind them for the number check. Shared by "explain this run" and the AI analysis, so both
 * check against the same figures.
 */
export function headlineResults(r: RunResults): { run: Record<string, unknown>; results: Record<string, unknown>; raw: Fact[] } {
  const money = (v: number) => formatWholeCurrency(v, r.currency);
  const range = (s: Stat, f: (v: number) => string) => `range ${f(s.p10)}–${f(s.p90)}`;
  const count = (s: Stat) => `avg ${formatNumber(s.mean, 1)} (${range(s, (v) => formatNumber(v, 0))})`;
  const results = {
    wins: count(r.won),
    lost: count(r.lost),
    cycleTime: `avg ${formatDays(r.cycle.mean, r.hours_per_week)} (median ${formatDays(r.cycle.p50, r.hours_per_week)}, P90 ${formatDays(r.cycle.p90, r.hours_per_week)})`,
    newMrr: `avg ${money(r.mrr_added.mean)} (${range(r.mrr_added, money)})`,
    billed: `avg ${money(r.billed.mean)} (${range(r.billed, money)})`,
    overtime: `avg ${formatHours(r.overtime_hours.mean)} (${range(r.overtime_hours, formatHours)})`,
    busiestRole: r.bottleneck ? { role: r.bottleneck.role, utilisation: `avg ${formatPercent(r.bottleneck.util.mean)} (${range(r.bottleneck.util, formatPercent)})` } : null,
  };
  const raw: Fact[] = [];
  statFacts("won", "plain", r.won, raw);
  statFacts("lost", "plain", r.lost, raw);
  statFacts("mrrAdded", "money", r.mrr_added, raw);
  statFacts("billed", "money", r.billed, raw);
  statFacts("overtime", "hours", r.overtime_hours, raw);
  raw.push(
    { key: "cycle.mean", kind: "hours", value: r.cycle.mean, step: 0 },
    { key: "cycle.p50", kind: "hours", value: r.cycle.p50, step: 0 },
    { key: "cycle.p90", kind: "hours", value: r.cycle.p90, step: 0 },
    { key: "reps", kind: "plain", value: r.reps, step: 0 },
    { key: "horizonWeeks", kind: "weeks", value: r.horizon_weeks, step: 0 },
  );
  if (r.bottleneck) statFacts("bottleneck.util", "percent", r.bottleneck.util, raw);
  return { run: { period: `${r.horizon_weeks} weeks`, replications: r.reps, currency: r.currency, ranges: "Every range is the 10th to 90th percentile of the replications." }, results, raw };
}

/** "Explain this run": a saved run's headline results. No names but the process and the busiest role. */
export function runNarrationInput(run: { id: string; name: string; created_at: string; results: RunResults }, processName: string): NarrationInput {
  const r = run.results;
  const template = runTemplate(r, processName);
  const head = headlineResults(r);
  const payload: Record<string, unknown> = {
    run: { process: processName, ...head.run },
    results: head.results,
    templatedExplanation: template,
  };
  const raw = head.raw;
  const names = [processName, run.name, ...(r.bottleneck ? [r.bottleneck.role] : [])];
  return {
    purpose: "explain",
    payload,
    check: context(payload, raw, [], names, r.currency, r.hours_per_week),
    aliases: [],
    template,
    hash: hashOf("explain", payload),
  };
}
