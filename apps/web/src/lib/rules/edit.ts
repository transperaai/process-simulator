// Editing a workspace's analysis rules (issue #109). Each function takes the settings document and returns the next
// one, never changing its input. Every result is passed through the engine's parser, which drops whatever equals the
// default, so a rule that has been put back is not "changed" and the stored document stays small. Pure.

import {
  inputsProblem,
  parseAnalysisSettings,
  toRatingConfig,
  detectIssues,
  type SuccessMeasureSource,
  type AbsenceTest,
  type AnalysisMoney,
  type AnalysisOverride,
  type AnalysisRuleId,
  type AnalysisSettings,
  type DetectedIssue,
  type EngineModel,
  type Rating,
  type RatingRuleId,
  type SimulationResult,
  ruleOfFinding,
  withoutDisabledRules,
  resolveMoney,
} from "@transpera-flow/engine";

const clean = (s: AnalysisSettings): AnalysisSettings => parseAnalysisSettings(s).value;

const withRule = (s: AnalysisSettings, rule: AnalysisRuleId, patch: Partial<NonNullable<AnalysisSettings["rules"]>[AnalysisRuleId]>): AnalysisSettings =>
  clean({ ...s, rules: { ...s.rules, [rule]: { ...s.rules?.[rule], ...patch } } });

export const setRuleEnabled = (s: AnalysisSettings, rule: AnalysisRuleId, enabled: boolean): AnalysisSettings =>
  withRule(s, rule, { enabled: enabled ? undefined : false });

/** Change a rule's cut-offs; the document is returned unchanged when they aren't allowed (see `inputsProblem`). */
export function setRuleInputs(s: AnalysisSettings, rule: AnalysisRuleId, inputs: number[]): AnalysisSettings {
  if (inputsProblem(rule, inputs)) return s;
  return withRule(s, rule, { inputs });
}

/** Put one rule back to its defaults, overrides included. */
export function resetRule(s: AnalysisSettings, rule: AnalysisRuleId): AnalysisSettings {
  const rules = { ...s.rules };
  delete rules[rule];
  return clean({ ...s, rules });
}

/** Put everything on the page back to its defaults: every rule, both escalators and the money settings. */
export const resetAll = (): AnalysisSettings => ({});

/** Add an override, or replace the one for the same subject. */
export function addOverride(s: AnalysisSettings, rule: AnalysisRuleId, override: AnalysisOverride): AnalysisSettings {
  const rest = (s.rules?.[rule]?.overrides ?? []).filter((o) => !(o.kind === override.kind && o.id === override.id));
  return withRule(s, rule, { overrides: [...rest, override] });
}

export function removeOverride(s: AnalysisSettings, rule: AnalysisRuleId, kind: AnalysisOverride["kind"], id: string): AnalysisSettings {
  return withRule(s, rule, { overrides: (s.rules?.[rule]?.overrides ?? []).filter((o) => !(o.kind === kind && o.id === id)) });
}

export const setEscalator = (s: AnalysisSettings, key: "badMonth" | "bottleneck", on: boolean): AnalysisSettings =>
  clean({ ...s, escalators: { ...s.escalators, [key]: on ? undefined : false } });

/** Change money settings; a key set to undefined goes back to its default. */
export const setMoney = (s: AnalysisSettings, patch: Partial<Omit<AnalysisMoney, "waitHours">> & { waitHours?: AnalysisMoney["waitHours"] }): AnalysisSettings =>
  clean({ ...s, money: { ...s.money, ...patch, waitHours: patch.waitHours ? { ...s.money?.waitHours, ...patch.waitHours } : s.money?.waitHours } });

/** The rule an issue's detector belongs to; null for findings that aren't from a rule on the rating model. */
const RATED = new Set<string>(["busy", "overtime", "queue", "wait", "rework", "sla", "spare", "spof", "dropoff", "cycle", "success", "driver"]);
export const ruleOfIssue = (i: Pick<DetectedIssue, "key">): RatingRuleId | null => {
  const rule = ruleOfFinding(i);
  return rule && RATED.has(rule) ? (rule as RatingRuleId) : null;
};

/**
 * Everything the Issues screens list for a run, under these rules: the rules' own findings, broken solutions and
 * perception gaps, without those of rules switched off (rules the engine doesn't rate yet still switch off).
 */
export function visibleFindings(settings: AnalysisSettings, findings: readonly DetectedIssue[]): DetectedIssue[] {
  return withoutDisabledRules(settings, findings);
}

/**
 * Rate a run again under these settings. No simulation: `result` is the run already made, and the same run serves
 * every settings document. This is what "changing a rule re-rates the latest run straight away" means.
 */
export function rerate(
  model: EngineModel,
  result: SimulationResult,
  settings: AnalysisSettings,
  processId?: string | null,
  /** The absence test's result for this model (its own pass, see `useAbsenceTest`); without it "only one person can do it" raises nothing. */
  absence?: AbsenceTest | null,
  /** The workspace currency for the cost descriptions, and the shadow prices the too-busy cost needs (issue #108). */
  costs: { currency?: string; shadowPrices?: Record<string, number>; successMeasures?: SuccessMeasureSource } = {},
): DetectedIssue[] {
  return detectIssues(model, result, toRatingConfig(settings, model.hoursPerWeek), {
    processId,
    absence,
    // The money settings (12-month cap, absences a year) are the workspace's.
    cost: { ...resolveMoney(settings), ...(costs.currency ? { currency: costs.currency } : {}) },
    ...(costs.shadowPrices ? { shadowPrices: costs.shadowPrices } : {}),
    // The success measures of the process's first principles, for rule 11 (goals met; issue #119).
    ...(costs.successMeasures ? { successMeasures: costs.successMeasures } : {}),
  });
}

export interface RatingTally {
  /** Findings at each rating (Great ones aren't findings). */
  byRating: Record<Exclude<Rating, "great">, number>;
  /** Findings from each rule on the rating model (the others still run their old logic). */
  byRule: Partial<Record<RatingRuleId, number>>;
  total: number;
}

export function tally(issues: readonly DetectedIssue[]): RatingTally {
  const t: RatingTally = { byRating: { risk: 0, bad: 0, good: 0 }, byRule: {}, total: 0 };
  for (const i of issues) {
    if (i.rating === "great") continue;
    const rule = ruleOfIssue(i);
    t.byRating[i.rating]++;
    if (rule) t.byRule[rule] = (t.byRule[rule] ?? 0) + 1;
    t.total++;
  }
  return t;
}
