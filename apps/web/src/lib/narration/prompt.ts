// The narration prompt (issue #29; docs/PRD.md §7.3: "The prompt requires the
// average-plus-range format and the robustness verdict"). The system prompt
// is fixed text, so it and the facts (sent first) form a stable prefix that
// the redraft request reuses from the prompt cache.

import type { NumberProblem } from "./numbers";
import type { NarrationPurpose } from "./facts";

const RULES = `Rules for numbers (a program checks every number you write against the facts and rejects the text if any one fails):
- Use only figures that appear in the facts, copied exactly as printed there: same rounding, same currency symbol, same unit. You may leave out a figure, but never compute a new one: no differences, sums, ratios, percentages of totals, "per week" conversions or rounding of your own.
- Every headline figure is an average with its range, in the facts' own form: "avg 8.6 (range 6–12)", "avg £33.0k (range £22.4k–£45.5k)".
- A percentage (%) is a share; a change between two percentages is in percentage points only where the facts say "points". Don't turn one into the other.
- Write every number in digits. Never use number words ("three", "a dozen") or multiples and fractions in words ("twice", "double", "half").
- No dates, weeks, months or quarters other than those in the facts (e.g. don't write "by week 6" or "in Q3").
- Refer to people and clients only by the labels in the facts ("Client A", "Team member B"); never invent names.`;

const SYSTEM: Record<NarrationPurpose, string> = {
  explain: `You explain one saved simulation run to the operations manager who ran it. The facts are JSON: the run's headline results from a discrete-event Monte Carlo simulation, each an average with its 10th–90th percentile range.

Write 1 to 3 short paragraphs of plain prose: what the run shows about throughput, time to an outcome, revenue and the busiest role, and what the ranges mean for how certain each figure is. British English, no headings, no bullet points, no markdown.

${RULES}`,
};

export function systemPrompt(purpose: NarrationPurpose): string {
  return SYSTEM[purpose];
}

/** The facts block (first, and cached). */
export function factsMessage(payload: Record<string, unknown>): string {
  return `Facts (JSON):\n${JSON.stringify(payload, null, 1)}`;
}

/** The instruction after the facts: the first draft, or the redraft naming the figures that failed. */
export function instruction(purpose: NarrationPurpose, rejected?: { paragraphs: string[]; problems: NumberProblem[] }): string {
  const ask = "Explain this run.";
  if (!rejected) return `${ask} Return JSON: {"paragraphs": [..]}.`;
  const list = rejected.problems.map((p) => `- “${p.text}”: ${p.reason}`).join("\n");
  return (
    `${ask} A previous draft was rejected because these numbers are not in the facts as written:\n${list}\n\n` +
    `The rejected draft:\n${rejected.paragraphs.join("\n\n")}\n\n` +
    `Write it again using only figures printed in the facts, copied exactly. Return JSON: {"paragraphs": [..]}.`
  );
}

/** The structured-output schema: a list of paragraphs. */
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" } } },
  required: ["paragraphs"],
  additionalProperties: false,
} as const;
