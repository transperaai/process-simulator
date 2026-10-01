// The demo's stand-in narrator (issue #29): /demo is public and has no
// sign-in, so it never calls the Anthropic API (that would put a paid API
// behind an open page). Instead this deterministic writer composes prose from
// the same facts Claude would get, and the result goes through the same
// number check, cache-free. It is labelled as a stand-in wherever it prints.

import type { RunResults } from "@transpera-flow/db";
import { withSummary } from "@/lib/report/assemble";
import type { ReportContent } from "@/lib/report/content";
import { reportNarrationInput, runNarrationInput } from "./facts";
import { narrate, type Draft, type DraftRequest, type NarrationModel, type NarrationOutcome } from "./narrate";
import { summaryFromNarration, type StoredNarration } from "./service";

export const DEMO_NARRATOR_NAME = "the demo's stand-in writer (no language model)";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function summaryDraft(facts: Json): string[] {
  const report = obj(facts.report);
  const figures = arr(facts.headlineFigures).map(obj);
  const fig = (label: string) => str(figures.find((f) => str(f.figure).startsWith(label))?.value);
  const out: string[] = [];
  const wins = fig("Wins");
  const lost = fig("Lost");
  const mrr = fig("New MRR");
  const billed = fig("Billed");
  out.push(
    `${str(report.process)} over ${str(report.period)}: the model expects ${wins ? `wins of ${wins}` : "the wins shown"}` +
      `${lost ? ` against ${lost} lost` : ""}.` +
      `${mrr ? ` New work brings ${mrr} in new monthly fees` : ""}${billed ? `, and billing comes to ${billed}` : ""}${mrr || billed ? "." : ""}`,
  );
  const bn = obj(facts.bottleneck);
  const findings = arr(bn.findings).map(str).filter(Boolean);
  if (findings.length) out.push(`What holds the business back: ${findings[0]!}${bn.oneMorePerson ? ` ${str(bn.oneMorePerson)}` : ""}`);
  const clients = obj(facts.clients);
  if (clients.atRiskAtEnd) {
    const most = arr(clients.mostAtRisk).map(str);
    out.push(
      `On retention, ${str(clients.atRiskAtEnd)} end the period at risk and ${str(clients.leave)} leave.` + (most.length ? ` The most exposed: ${list(most)}.` : ""),
    );
  }
  for (const s of arr(facts.scenarios).map(obj)) {
    const sensitive = arr(s.mostSensitiveInputs).map(obj)[0];
    out.push(
      `${str(s.headline)}${s.robustnessVerdict ? ` How far to trust it: ${str(s.robustnessVerdict)}` : ""}` +
        (sensitive ? ` The input that matters most is “${str(sensitive.input)}” (${str(sensitive.effect)}).` : ""),
    );
  }
  const issues = obj(facts.openIssues);
  if (typeof issues.total === "number" && issues.total > 0) {
    const risk = obj(issues.byRating).risk;
    out.push(`The issues register lists ${issues.total} open issues${typeof risk === "number" && risk > 0 ? `, ${risk} of them operational risks` : ""}.`);
  }
  return out;
}

function explainDraft(facts: Json): string[] {
  const run = obj(facts.run);
  const r = obj(facts.results);
  const role = obj(r.busiestRole);
  return [
    `Across ${String(run.replications ?? "")} replications of ${str(run.period)}, ${str(run.process)} wins ${str(r.wins)} and loses ${str(r.lost)}. ` +
      `Each figure is an average with the range most replications fall inside (the 10th to 90th percentile), so the wider the range, the less certain the figure.`,
    `An item takes ${str(r.cycleTime)} from arrival to an outcome. New work adds ${str(r.newMrr)} in new MRR, and billing comes to ${str(r.billed)}.` +
      (role.role ? ` ${str(role.role)} is the busiest role at ${str(role.utilisation)} utilised, so it sets the pace.` : ""),
  ];
}

/** The stand-in: prose from the facts, every figure copied as printed. */
export const demoNarrator: NarrationModel = {
  name: DEMO_NARRATOR_NAME,
  async draft(req: DraftRequest): Promise<Draft> {
    const facts = JSON.parse(req.facts.slice(req.facts.indexOf("{"))) as Json;
    return { paragraphs: req.purpose === "summary" ? summaryDraft(facts) : explainDraft(facts), model: DEMO_NARRATOR_NAME, usage: null };
  },
};

const stored = (o: NarrationOutcome, at: string): StoredNarration => ({ ...o, id: null, cached: false, at, editedBy: null, editedAt: null });

/** The demo report with its summary narrated by the stand-in (checked like Claude's). */
export async function demoNarratedContent(content: ReportContent, at = new Date().toISOString()): Promise<ReportContent> {
  if (!content.summary) return content;
  const outcome = await narrate(reportNarrationInput(content), demoNarrator);
  return withSummary(content, summaryFromNarration(stored(outcome, at)));
}

/** "Explain this run" on the demo. */
export async function demoExplanation(run: { id: string; name: string; created_at: string; results: RunResults }, processName: string, at = new Date().toISOString()) {
  return stored(await narrate(runNarrationInput(run, processName), demoNarrator), at);
}
