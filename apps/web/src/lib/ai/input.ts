// From a process version and its run to what AI analysis is given (issue #111, A46). Pure and shared by the server
// (after a publish, a market change or "Run again"), the tests and the demo's stand-in, so every one of them reads a
// run the same way the pages do: the same rule findings, the same first-principles checks.

import { runResults, type ProcessBundle } from "@transpera-flow/db";
import {
  firstPrinciplesFlags,
  isBlank,
  measuresMetToday,
  successMeasureSource,
  type AbsenceTest,
  type AnalysisSettings,
  type DetectedIssue,
  type EngineModel,
  type FirstPrinciples,
  type SimulationResult,
} from "@transpera-flow/engine";
import { processSteps } from "@/lib/process-steps";
import { rerate, visibleFindings } from "@/lib/rules/edit";
import { buildAiInput, type AiInput } from "./facts";

export interface AiRunInput {
  bundle: ProcessBundle;
  model: EngineModel;
  result: SimulationResult;
  /** The workspace's analysis rules (omitted: the defaults). */
  rules?: AnalysisSettings;
  /** The version's first principles; null when it has none. */
  firstPrinciples: FirstPrinciples | null;
  absence?: AbsenceTest | null;
  /** What one more person in each busy role would bring, for costing the too-busy findings (omitted: those costs read "n/a"). */
  shadowPrices?: Record<string, number>;
  /** Quotes from linked sources, if the workspace reads sources. */
  quotes?: { step: string; quote: string }[] | null;
}

/** Short quotes cited on this process's steps (their provenance evidence), for when the workspace lets AI read sources. */
export function quotesFromBundle(bundle: ProcessBundle, limit = 12): { step: string; quote: string }[] {
  const out: { step: string; quote: string }[] = [];
  const seen = new Set<string>();
  for (const step of processSteps(bundle)) {
    const provenance = step.provenance as unknown;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) continue;
    for (const entry of Object.values(provenance as Record<string, unknown>)) {
      const evidence = entry && typeof entry === "object" ? (entry as { evidence?: unknown }).evidence : null;
      if (!Array.isArray(evidence)) continue;
      for (const c of evidence) {
        const quote = c && typeof c === "object" ? (c as { quote?: unknown }).quote : null;
        if (typeof quote !== "string" || !quote.trim()) continue;
        const key = `${step.id}|${quote}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ step: step.name, quote });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** The rule findings the pages list for this run (the same call the process page makes, without the broken-scenario and perception-gap findings). */
export function ruleFindings(run: Pick<AiRunInput, "bundle" | "model" | "result" | "rules" | "firstPrinciples" | "absence" | "shadowPrices">): DetectedIssue[] {
  const rules = run.rules ?? {};
  const successMeasures = run.firstPrinciples ? successMeasureSource(run.firstPrinciples, run.bundle.process.id) : undefined;
  return visibleFindings(
    rules,
    rerate(run.model, run.result, rules, run.bundle.process.id, run.absence, {
      currency: run.bundle.workspace.settings.currency,
      ...(run.shadowPrices ? { shadowPrices: run.shadowPrices } : {}),
      ...(successMeasures ? { successMeasures } : {}),
    }),
  );
}

/** The roles whose too-busy findings need a shadow price (an extra run) to be costed, as `useDetectedIssues` works out. */
export const costedRoleIds = (issues: readonly DetectedIssue[]): string[] => [...new Set(issues.filter((i) => i.key.startsWith("capacity:") && i.roleId).map((i) => i.roleId!))].sort();

/** What AI is given for this run: the facts it may use, and what its text is checked against. Null when there are no first principles to review. */
export function aiInputForRun(run: AiRunInput): { input: AiInput; findings: DetectedIssue[] } | null {
  const fp = run.firstPrinciples;
  if (!fp || isBlank(fp)) return null;
  const { bundle } = run;
  const findings = ruleFindings(run);
  const steps = processSteps(bundle)
    .filter((s) => s.kind !== "start" && s.kind !== "end")
    .map((s) => ({ id: s.id, name: s.name }));
  const people = bundle.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const roles = bundle.roles.map((r) => ({ name: r.name }));
  const measures = measuresMetToday(fp, run.model, run.result, bundle.process.id);
  const checks = measures.flatMap((m) => (m.check ? [m.check] : []));
  const flags = firstPrinciplesFlags(fp, {
    steps: bundle.steps.filter((s) => s.kind === "task" || s.kind === "wait" || s.kind === "decision" || s.kind === "subprocess").map((s) => ({ id: s.id, name: s.name })),
    people: bundle.people.map((p) => ({ id: p.id, name: p.name })),
    roles,
    checks,
  });
  const currency = bundle.workspace.settings.currency;
  const input = buildAiInput({
    processName: bundle.process.name,
    results: runResults(run.model, run.result, currency),
    findings,
    steps,
    roles,
    people,
    firstPrinciples: fp,
    flags,
    measures,
    quotes: run.quotes ?? null,
    marketOn: Boolean(run.model.market),
    currency,
  });
  return { input, findings };
}
