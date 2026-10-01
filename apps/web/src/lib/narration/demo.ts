// The demo's stand-in narrator (issue #29): /demo is public and has no
// sign-in, so it never calls the Anthropic API (that would put a paid API
// behind an open page). Instead this deterministic writer composes prose from
// the same facts Claude would get, and the result goes through the same
// number check, cache-free. It is labelled as a stand-in wherever it prints.

import type { RunResults } from "@transpera-flow/db";
import { runNarrationInput } from "./facts";
import { narrate, type Draft, type DraftRequest, type NarrationModel, type NarrationOutcome } from "./narrate";
import type { StoredNarration } from "./service";

export const DEMO_NARRATOR_NAME = "the demo's stand-in writer (no language model)";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

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
    return { paragraphs: explainDraft(facts), model: DEMO_NARRATOR_NAME, usage: null };
  },
};

const stored = (o: NarrationOutcome, at: string): StoredNarration => ({ ...o, id: null, cached: false, at, editedBy: null, editedAt: null });

/** "Explain this run" on the demo. */
export async function demoExplanation(run: { id: string; name: string; created_at: string; results: RunResults }, processName: string, at = new Date().toISOString()) {
  return stored(await narrate(runNarrationInput(run, processName), demoNarrator), at);
}
