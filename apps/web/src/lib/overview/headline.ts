// The Overview's four headline cards (issue #100, A35), as plain words and numbers. Pure, so the wording and the
// arithmetic are tested without a page.

import { withClientGroups, type EngineModel, type SimulationResult, type Stat } from "@transpera-flow/engine";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { horizonLabel } from "@/lib/horizon";
import type { Band, StartingMrr } from "./projection";

export interface HeadlineCard {
  key: "won" | "mrr" | "churn" | "bottleneck";
  label: string;
  value: string;
  /** The 10-90% range, or what stands in for it. */
  range: string;
  /** One more line under the range. */
  note?: string;
  /** Draws the value in the "bad" colour. */
  tone?: "warn" | "crit";
  help: { description: string; example: string };
}

const WEEKS_PER_MONTH = 52 / 12;

const whole = (v: number) => formatNumber(v, 0);

/** "range 2.6–5.7", with the numbers in one format. */
function rangeOf(stat: Pick<Stat, "p10" | "p90">, fmt: (v: number) => string): string {
  const lo = fmt(stat.p10);
  const hi = fmt(stat.p90);
  return lo === hi ? `range ${lo}` : `range ${lo}–${hi}`;
}

/** Clients who leave over the run: counted one by one when the model has client records, else the interim count's expected decay. */
export function clientsLost(model: EngineModel, result: SimulationResult, start: StartingMrr): { stat: Stat | null; mean: number } {
  const counted = withClientGroups(model).clients !== undefined ? result.kpi.clientsChurned : undefined;
  if (counted) return { stat: counted, mean: counted.mean };
  const months = model.horizonWeeks / WEEKS_PER_MONTH;
  const share = 1 - Math.pow(1 - Math.min(1, Math.max(0, model.churnMonthly)), months);
  return { stat: null, mean: start.clients * share };
}

export function headlineCards(input: {
  model: EngineModel;
  result: SimulationResult;
  /** The MRR at the end of the horizon. */
  mrr: Band;
  start: StartingMrr;
  months: number;
  currency: string;
}): HeadlineCard[] {
  const { model, result, mrr, start, months, currency } = input;
  const span = `over ${horizonLabel(months)}`;
  const money = (v: number) => formatCurrency(v, currency);
  const lost = clientsLost(model, result, start);
  const bnId = result.bnRole;
  const bn = bnId ? result.kpi.roles[bnId] : undefined;
  const bnName = bnId ? (model.roles[bnId]?.name ?? null) : null;
  const bnStep = result.bnStep ? model.steps.find((s) => s.id === result.bnStep)?.name : undefined;
  const busy = bn?.util;
  const hot = !!busy && busy.mean >= 0.85;
  return [
    {
      key: "won",
      label: "New clients won",
      value: formatNumber(result.kpi.won.mean),
      range: `${rangeOf(result.kpi.won, whole)} ${span}`,
      help: {
        description:
          "How many new clients your sales process signs over the time you picked, averaged over 30 simulated runs. The range is where most runs land: the 10th to the 90th percentile, so one run in ten falls below it and one in ten above.",
        example: "If it says 12 with a range of 8–17 over 3 months, expect about 12 new clients, and very likely between 8 and 17.",
      },
    },
    {
      key: "mrr",
      label: months <= 1 ? "MRR in 1 month" : `MRR at month ${months}`,
      value: money(mrr.mean),
      range: `range ${money(mrr.lo)}–${money(mrr.hi)}`,
      note: `Now ${money(start.mrr)} · an estimate`,
      help: {
        description:
          "An estimate of monthly recurring revenue: what your clients pay you every month. It starts from today's clients, adds the revenue of the clients you win, and takes away the clients who leave, assuming each one who leaves pays today's average fee. The range covers how much new-client revenue varies across 30 runs; it does not include uncertainty in who leaves.",
        example: "Now 80k and 91k at month 6 means the average run grows by about 11k; one run in ten adds less than the bottom of the range says.",
      },
    },
    {
      key: "churn",
      label: "Clients lost to churn",
      value: formatNumber(lost.mean),
      range: lost.stat ? `${rangeOf(lost.stat, (v) => formatNumber(v))} ${span}` : `about ${formatPercent(start.clients ? lost.mean / start.clients : 0)} of clients ${span}`,
      note: lost.stat ? "Including new clients who leave" : "An estimate: clients aren't counted one by one yet",
      help: {
        description:
          "Clients who leave over the time you picked, including clients you win during it and then lose. Each client's chance of leaving goes up when their work is late or missed, so this moves when you fix delivery.",
        example: "With 30 clients today, 6 over 3 months means about one in five leaves in a quarter (more once new clients are counted), and more if servicing slips.",
      },
    },
    {
      key: "bottleneck",
      label: "Bottleneck",
      value: bnName ?? "None",
      range: busy ? `${formatPercent(busy.mean)} busy · ${formatPercent(busy.p90)} in a bad month` : "No role is busy",
      note: bnStep ? `Longest queue: ${bnStep}` : undefined,
      tone: busy ? (busy.mean >= 0.95 ? "crit" : hot ? "warn" : undefined) : undefined,
      help: {
        description:
          "The role that is busiest, where work queues up first. It limits how much more the business can take on. A bad month is the 90th percentile: how busy they get one run in ten.",
        example: "Strategist at 82% busy and 97% in a bad month means one month in ten they have more work than hours.",
      },
    },
  ];
}
