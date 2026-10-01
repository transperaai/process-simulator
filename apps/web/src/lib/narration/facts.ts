// What narration is given, and what it is checked against (issue #29;
// docs/PRD.md §7.3, D15; docs/adr/0011-narration.md). For a report's
// executive summary: the figures and sentences the report prints (headline
// figures with ranges, the bottleneck, clients, each scenario's comparison and
// robustness verdict, issue counts, and the templated summary as a model of
// the house style). For "explain this run": a saved run's headline results.
//
// Privacy: only what the text needs goes to the model. No workspace name,
// people or client names (people and clients become "Team member A",
// "Client B", mapped back after the check), no evidence quotes, sources,
// issue titles or per-person figures, and nothing from the appendix.
//
// The check context holds every figure in that payload, read with the same
// tokenizer the check uses (so "£4.2k" in the payload is known to £100), plus
// the raw means and range ends behind them (so "£33,005" is accepted too).

import { createHash } from "node:crypto";
import type { RunResults } from "@transpera-flow/db";
import type { Stat } from "@transpera-flow/engine";
import { formatDays, formatHours, formatNumber, formatPercent, formatWholeCurrency } from "@/lib/format";
import type { FigureFormat, ReportContent } from "@/lib/report/content";
import { avgWithRange, formatDate, formatFigure, type FigureContext } from "@/lib/report/format";
import { buildSummary } from "@/lib/report/summary";
import { factsFromText, type CheckContext, type Fact, type NumberKind } from "./numbers";

export type NarrationPurpose = "summary" | "explain";

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

const letters = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + letters(i % 26));

function makeAliases(people: readonly string[], clients: readonly string[]) {
  const aliases: { name: string; label: string }[] = [];
  [...new Set(clients)].forEach((name, i) => aliases.push({ name, label: `Client ${letters(i)}` }));
  [...new Set(people)].forEach((name, i) => aliases.push({ name, label: `Team member ${letters(i)}` }));
  return aliases.filter((a) => a.name.trim().length > 0).sort((a, b) => b.name.length - a.name.length);
}

/** Replace every name with its label (longest names first, so "Sam Lee" wins over "Sam"). */
export function redact(text: string, aliases: readonly { name: string; label: string }[]): string {
  let out = text;
  for (const a of aliases) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(a.name)}(?![\\p{L}\\p{N}])`, "gu"), a.label);
  return out;
}

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

function deepRedact(value: unknown, aliases: readonly { name: string; label: string }[]): unknown {
  if (typeof value === "string") return redact(value, aliases);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, aliases));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v, aliases)]));
  return value;
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

const KIND_OF: Record<FigureFormat, NumberKind> = { count: "plain", money: "money", days: "hours", hours: "hours", percent: "percent" };

/** The raw figures behind a stat, in the kind's units (shares as %). */
function statFacts(key: string, kind: NumberKind, s: Stat, out: Fact[]) {
  const scale = kind === "percent" ? 100 : 1;
  out.push({ key: `${key}.mean`, kind, value: s.mean * scale, step: 0 });
  out.push({ key: `${key}.p10`, kind, value: s.p10 * scale, step: 0 });
  out.push({ key: `${key}.p90`, kind, value: s.p90 * scale, step: 0 });
}

function context(payload: Record<string, unknown>, raw: Fact[], dates: string[], names: string[], currency: string, hoursPerWeek: number): CheckContext {
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

function namesOf(c: ReportContent): { people: string[]; clients: string[] } {
  if (c.names) return c.names;
  return { people: c.utilisation?.people.map((p) => p.name) ?? [], clients: c.clients?.clients.map((x) => x.name) ?? [] };
}

/** The executive summary's input: from the report's content, never its current summary (so edits don't change it). */
export function reportNarrationInput(c: ReportContent): NarrationInput {
  const ctx: FigureContext = { currency: c.run.currency, hoursPerWeek: c.run.hoursPerWeek };
  const names = namesOf(c);
  const aliases = makeAliases(names.people, names.clients);
  const template = buildSummary({ ...c, summary: null }).paragraphs;

  const figures = c.kpis.map((k) => ({
    figure: k.label,
    value:
      k.range === "p50_p90"
        ? `avg ${formatFigure(k.format, k.stat.mean, ctx)} (median ${formatFigure(k.format, k.stat.p10, ctx)}, P90 ${formatFigure(k.format, k.stat.p90, ctx)})`
        : avgWithRange(k.format, k.stat, ctx),
    meaning: k.definition,
  }));
  const payload: Record<string, unknown> = {
    report: {
      process: c.process.name,
      itemsAre: c.process.entityName || "items",
      period: `${c.run.horizonWeeks} weeks from ${formatDate(c.run.startDate)}`,
      replications: c.run.reps,
      currency: c.run.currency,
      ranges: "Every range is the 10th to 90th percentile of the replications.",
    },
    headlineFigures: figures,
  };
  if (c.bottlenecks) {
    payload.bottleneck = {
      findings: c.bottlenecks.text,
      oneMorePerson: c.bottlenecks.shadowPrice?.text ?? null,
      busiestRoles: c.bottlenecks.roles.slice(0, 3).map((r) => ({ role: r.name, utilisation: avgWithRange("percent", r.util, ctx) })),
    };
  }
  if (c.clients) {
    payload.clients = {
      atRiskAtEnd: `avg ${formatNumber(c.clients.atRisk.mean, 1)} clients (${rangeText("count", c.clients.atRisk, ctx)})`,
      leave: `avg ${formatNumber(c.clients.churned.mean, 1)} clients (${rangeText("count", c.clients.churned, ctx)})`,
      mostAtRisk: c.clients.clients.filter((x) => x.atRisk >= 0.5).slice(0, 3).map((x) => x.name),
      atRiskMeans: "health below 50 at the end of the period",
    };
  }
  if (c.scenarios?.length) {
    payload.scenarios = c.scenarios.map((s) => ({
      name: s.name,
      changes: s.changes,
      headline: s.headline,
      details: s.details,
      table: s.table.map((r) => ({ metric: r.label, baseline: r.baseline, scenario: r.scenario, change: r.change, changeRange: r.changeRange })),
      robustnessVerdict: s.robustness?.verdict ?? null,
      mostSensitiveInputs: (s.robustness?.sensitive ?? []).slice(0, 3).map((x) => ({ input: x.label, effect: x.effect, flipsTheAnswer: x.flips })),
      checkComplete: s.robustness?.complete ?? null,
    }));
  }
  if (c.excludedScenarios.length) payload.scenariosLeftOut = c.excludedScenarios.map((s) => ({ name: s.name, reason: "needs attention: it refers to something no longer in the model" }));
  if (c.issues) {
    const byRating = Object.fromEntries(c.issues.groups.map((g) => [g.rating, g.issues.length]));
    payload.openIssues = { total: c.issues.groups.reduce((n, g) => n + g.issues.length, 0), byRating };
  }
  payload.templatedSummary = template;

  const redacted = deepRedact(payload, aliases) as Record<string, unknown>;
  const raw: Fact[] = [];
  for (const k of c.kpis) statFacts(`kpi.${k.key}`, KIND_OF[k.format], k.stat, raw);
  raw.push({ key: "run.reps", kind: "plain", value: c.run.reps, step: 0 }, { key: "run.horizonWeeks", kind: "weeks", value: c.run.horizonWeeks, step: 0 });
  if (c.bottlenecks?.shadowPrice) statFacts("shadowPrice.perQuarter", "plain", c.bottlenecks.shadowPrice.perQuarter, raw);
  c.bottlenecks?.roles.slice(0, 3).forEach((r, i) => statFacts(`bottleneck.role${i}.util`, "percent", r.util, raw));
  if (c.clients) {
    statFacts("clients.atRisk", "plain", c.clients.atRisk, raw);
    statFacts("clients.churned", "plain", c.clients.churned, raw);
  }
  c.scenarios?.forEach((s, i) => {
    if (s.robustness) raw.push({ key: `scenario${i}.robustness.signHolds`, kind: "percent", value: s.robustness.signHolds * 100, step: 0 });
  });
  const labels = aliases.map((a) => a.label);
  const nameList = [c.process.name, ...(c.scenarios ?? []).map((s) => s.name), ...c.excludedScenarios.map((s) => s.name), ...labels];
  return {
    purpose: "summary",
    payload: redacted,
    check: context(redacted, raw, [c.run.startDate], nameList, c.run.currency, c.run.hoursPerWeek),
    aliases,
    template,
    hash: hashOf("summary", redacted),
  };
}

/** The check for text a person wrote (an edit): the same figures, with real names as well as labels. */
export function editCheck(input: NarrationInput): CheckContext {
  return { ...input.check, names: [...input.check.names, ...input.aliases.map((a) => a.name)] };
}

function rangeText(format: FigureFormat, s: Stat, ctx: FigureContext): string {
  const f = (v: number) => (format === "count" ? formatNumber(v, 0) : formatFigure(format, v, ctx));
  const lo = f(s.p10);
  const hi = f(s.p90);
  return lo === hi ? `range ${lo}` : `range ${lo}–${hi}`;
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

/** "Explain this run": a saved run's headline results. No names but the process and the busiest role. */
export function runNarrationInput(run: { id: string; name: string; created_at: string; results: RunResults }, processName: string): NarrationInput {
  const r = run.results;
  const money = (v: number) => formatWholeCurrency(v, r.currency);
  const range = (s: Stat, f: (v: number) => string) => `range ${f(s.p10)}–${f(s.p90)}`;
  const count = (s: Stat) => `avg ${formatNumber(s.mean, 1)} (${range(s, (v) => formatNumber(v, 0))})`;
  const template = runTemplate(r, processName);
  const payload: Record<string, unknown> = {
    run: { process: processName, period: `${r.horizon_weeks} weeks`, replications: r.reps, currency: r.currency, ranges: "Every range is the 10th to 90th percentile of the replications." },
    results: {
      wins: count(r.won),
      lost: count(r.lost),
      cycleTime: `avg ${formatDays(r.cycle.mean, r.hours_per_week)} (median ${formatDays(r.cycle.p50, r.hours_per_week)}, P90 ${formatDays(r.cycle.p90, r.hours_per_week)})`,
      newMrr: `avg ${money(r.mrr_added.mean)} (${range(r.mrr_added, money)})`,
      billed: `avg ${money(r.billed.mean)} (${range(r.billed, money)})`,
      overtime: `avg ${formatHours(r.overtime_hours.mean)} (${range(r.overtime_hours, formatHours)})`,
      busiestRole: r.bottleneck ? { role: r.bottleneck.role, utilisation: `avg ${formatPercent(r.bottleneck.util.mean)} (${range(r.bottleneck.util, formatPercent)})` } : null,
    },
    templatedExplanation: template,
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
