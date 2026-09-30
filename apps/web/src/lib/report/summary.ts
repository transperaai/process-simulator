// The report's templated text (docs/PRD.md §7.3, decision D15; issue #28):
// the executive summary and the methodology page, filled in from the report's
// own figures with fixed templates, never a language model. Every number in
// them is one of the content's numbers, formatted the way the rest of the
// report formats it, and every headline figure comes with its range.
//
// Narration (#29) builds on this: `reportFacts` lists the numbers a narrated
// summary may use (what its validator checks each number against), and the
// templated summary stays the fallback when narration fails validation.

import type { EngineModel, Stat } from "@transpera-flow/engine";
import type { ExecutiveSummary, KpiFigure, MethodologyView, ReportContent } from "./content";
import { avgWithRange, formatDate, formatFigure, type FigureContext } from "./format";

const figure = (c: ReportContent, key: string): KpiFigure | undefined => c.kpis.find((k) => k.key === key);
const ctxOf = (c: ReportContent): FigureContext => ({ currency: c.run.currency, hoursPerWeek: c.run.hoursPerWeek });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The executive summary, from templates. Paragraphs are omitted when there is nothing to say. */
export function buildSummary(c: ReportContent): ExecutiveSummary {
  const ctx = ctxOf(c);
  const f = (key: string) => {
    const k = figure(c, key);
    return k ? avgWithRange(k.format, k.stat, ctx) : "";
  };
  const paragraphs: string[] = [];
  const entity = c.process.entityName.toLowerCase() || "item";
  const cycle = figure(c, "cycle");

  paragraphs.push(
    `Over the ${c.run.horizonWeeks} weeks from ${formatDate(c.run.startDate)}, ${c.process.name} wins ${f("won")} and loses ${f("lost")}. ` +
      (cycle
        ? `A ${entity} takes avg ${formatFigure("days", cycle.stat.mean, ctx)} from arrival to an outcome (median ${formatFigure("days", cycle.stat.p10, ctx)}, P90 ${formatFigure("days", cycle.stat.p90, ctx)}). `
        : "") +
      `New work adds ${f("mrrAdded")} in new MRR, and the business bills ${f("billed")} in the period.`,
  );

  if (c.bottlenecks) {
    const bits = [...c.bottlenecks.text];
    if (c.bottlenecks.shadowPrice) bits.push(c.bottlenecks.shadowPrice.text);
    paragraphs.push(bits.join(" "));
  }

  if (c.clients) {
    const worst = c.clients.clients.filter((x) => x.atRisk >= 0.5).map((x) => x.name);
    paragraphs.push(
      `Of the client roster, ${avgWithRange("count", c.clients.atRisk, ctx)} clients end the period at risk (health below 50) and ` +
        `${avgWithRange("count", c.clients.churned, ctx)} leave.` +
        (worst.length ? ` Most at risk: ${listText(worst.slice(0, 3))}.` : " No client ends at risk in most runs."),
    );
  }

  if (c.scenarios?.length) {
    for (const s of c.scenarios) {
      const verdict = s.robustness ? ` Robustness: ${s.robustness.verdict}` : "";
      paragraphs.push(`${s.headline}${verdict}`);
    }
  }
  if (c.excludedScenarios.length) {
    paragraphs.push(`${listText(c.excludedScenarios.map((s) => `“${s.name}”`))} ${c.excludedScenarios.length === 1 ? "needs" : "need"} attention and ${c.excludedScenarios.length === 1 ? "is" : "are"} left out.`);
  }

  if (c.issues) {
    const counts = c.issues.groups.map((g) => `${g.issues.length} ${g.severity}`);
    const total = c.issues.groups.reduce((n, g) => n + g.issues.length, 0);
    if (total) paragraphs.push(`The issues register lists ${plural(total, "open issue")}: ${listText(counts)}.`);
  }

  return { source: "template", paragraphs, editedBy: null };
}

function listText(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The one-page methodology. */
export function buildMethodology(c: ReportContent, model: EngineModel): MethodologyView {
  const start =
    c.run.initialState.kind === "wip"
      ? `It starts from the work in progress entered on the map (${c.run.initialState.items} items).`
      : c.run.initialState.kind === "warmup"
        ? `It first runs a warm-up of ${Math.round((c.run.initialState.hours / c.run.hoursPerWeek) * 10) / 10} weeks, which is discarded, so the business is already busy when measuring starts.`
        : "It starts from an empty business (no work in progress entered, no warm-up).";
  const clients = model.clients
    ? " Each client on the roster generates servicing work (reports, check-ins, ad-hoc requests) that competes for the same people. Tasks done on time raise a client's health; late or missed ones lower it, and monthly churn rises as health falls."
    : "";
  return {
    paragraphs: [
      `The figures come from a discrete-event Monte Carlo simulation of the business as mapped: work arrives from the demand model, queues at each step for the people who can do it, takes a sampled amount of hands-on time and waiting, and is routed on by the map's branch shares until it is won, lost or done. People work their contracted hours less leave and ongoing client work.${clients}`,
      `This report ran ${c.run.reps} replications of ${c.run.horizonWeeks} working weeks (${c.run.hoursPerWeek} hours a week) from seed ${c.run.seed}, with engine ${c.run.engineVersion}. ${start} The same seed and model always give the same numbers, in the browser and on the server.`,
      "Every figure is the average across replications with its range: the 10th to the 90th percentile of the replications, so eight runs in ten fall inside it. Cycle times also give the median (P50) and the 90th percentile (P90).",
      "Scenarios are compared replication by replication with the same random numbers on both sides (common random numbers), so a change's range reflects the change rather than luck.",
      "Robustness: every estimated input (anything not entered or measured, including the client-health defaults) is moved 25% down and up one at a time, or across the range people gave where sources disagree, at 10 replications each; the most influential inputs are re-run at 30. The verdict says how often the bottleneck and the direction of each change hold, and flags any input whose disagreement flips the answer. A check that ran out of time says how far it got.",
      "The bottleneck is the busiest role by utilisation (hands-on pipeline, servicing and ongoing client hours over capacity plus overtime). Its shadow price is the extra completed items a quarter from one more full-time person in that role, from an extra paired replication set. People are modelled for capacity, not performance: no one is ranked.",
      "All text in this report is filled in from fixed templates using the run's own numbers; no language model wrote any of it.",
    ],
  };
}

/**
 * Every number the report states, by a stable key: what narration (#29) may
 * cite. Means and both ends of each range, per KPI, scenario delta row,
 * client and shadow price.
 */
export function reportFacts(c: ReportContent): Record<string, number> {
  const out: Record<string, number> = {};
  const stat = (key: string, s: Stat) => {
    out[`${key}.mean`] = s.mean;
    out[`${key}.p10`] = s.p10;
    out[`${key}.p90`] = s.p90;
  };
  for (const k of c.kpis) stat(`kpi.${k.key}`, k.stat);
  out["run.reps"] = c.run.reps;
  out["run.horizonWeeks"] = c.run.horizonWeeks;
  if (c.bottlenecks?.shadowPrice) stat("shadowPrice.perQuarter", c.bottlenecks.shadowPrice.perQuarter);
  c.bottlenecks?.roles.forEach((r, i) => stat(`bottleneck.role${i}.util`, r.util));
  c.clients?.clients.forEach((cl, i) => {
    stat(`client${i}.health`, cl.health);
    out[`client${i}.churned`] = cl.churned;
    out[`client${i}.atRisk`] = cl.atRisk;
  });
  c.scenarios?.forEach((s, i) => {
    s.roles.forEach((r, j) => {
      stat(`scenario${i}.role${j}.baseline`, r.baseline);
      stat(`scenario${i}.role${j}.scenario`, r.scenario);
    });
    if (s.robustness) out[`scenario${i}.robustness.signHolds`] = s.robustness.signHolds;
  });
  return out;
}
