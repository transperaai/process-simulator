import type { EngineModel, SimulationResult } from "@transpera-flow/engine";
import { formatCurrency, formatDays, formatInitialState, formatNumber, formatPercent, formatRange } from "@/lib/format";

interface KpiStripProps {
  model: EngineModel;
  currency: string;
  result: SimulationResult | null;
  status: "running" | "done" | "error";
  durationMs?: number;
}

interface Tile {
  label: string;
  value: string;
  detail: string;
  /** What the figure means (docs/PRD.md §13), shown on hover. */
  definition?: string;
  tone?: "crit";
}

export function KpiStrip({ model, currency, result, status, durationMs }: KpiStripProps) {
  const k = result?.kpi;
  const whole = (v: number) => formatNumber(v, 0);
  const days = (h: number) => formatDays(h, model.hoursPerWeek);
  const money = (v: number) => formatCurrency(v, currency);
  const bnId = result?.bnRole ?? null;
  const bn = bnId ? k?.roles[bnId] : undefined;
  const weeks = model.horizonWeeks;

  // Two rows of four: the flow, then the revenue it brings in.
  const tiles: Tile[] = [
    { label: `Wins / ${weeks} wks`, value: k ? formatNumber(k.won.mean) : "–", detail: k ? formatRange(k.won, whole) : "" },
    { label: "Lost", value: k ? whole(k.lost.mean) : "–", detail: k ? formatRange(k.lost, whole) : "" },
    {
      label: "Cycle time",
      value: k ? days(k.cycle.mean) : "–",
      detail: k ? `P50 ${days(k.cycle.p50)} · P90 ${days(k.cycle.p90)}` : "",
    },
    {
      label: "Bottleneck",
      value: bnId ? (model.roles[bnId]?.name ?? "–") : "–",
      detail: bn ? `${formatPercent(bn.util.mean)} utilised · ${formatRange(bn.util, formatPercent)}` : "",
      tone: bn && bn.util.mean > 0.85 ? "crit" : undefined,
    },
    {
      label: "New MRR",
      value: k ? money(k.mrrAdded.mean) : "–",
      detail: k ? formatRange(k.mrrAdded, money) : "",
      definition: "Monthly fees of the retainer clients won in the horizon.",
    },
    {
      label: `Billed / ${weeks} wks`,
      value: k ? money(k.billed.mean) : "–",
      detail: k ? formatRange(k.billed, money) : "",
      definition:
        "Revenue billed within the horizon by the clients won in it, net of churn; one-off projects bill when won. Existing clients aren't included yet.",
    },
    {
      label: "LTV added",
      value: k ? money(k.ltvAdded.mean) : "–",
      detail: k ? formatRange(k.ltvAdded, money) : "",
      definition: "For each new win: price × expected tenure (retainers) or the price (one-off).",
    },
    {
      label: "Lost revenue",
      value: k ? money(k.lostRevenue.mean) : "–",
      detail: k ? formatRange(k.lostRevenue, money) : "",
      definition: "For each lost lead: what it would have been worth if won (price × expected tenure for retainers).",
    },
  ];

  return (
    <section aria-label="Key results" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} title={t.definition} className="min-w-0 rounded-token border border-line bg-panel px-3 py-2 shadow-token">
          <p className="font-mono text-[11px] uppercase tracking-widest text-fg-3">{t.label}</p>
          <p className={`truncate font-display text-xl font-bold tabular-nums ${t.tone === "crit" ? "text-crit" : ""}`}>{t.value}</p>
          <p className="text-xs text-fg-2 tabular-nums">{t.detail}&nbsp;</p>
        </div>
      ))}
      <p role="status" aria-live="polite" className="col-span-full text-xs text-fg-3">
        {status === "running"
          ? "Simulating…"
          : status === "error"
            ? "Simulation failed"
            : `Average of ${result?.reps} replications; ranges are the 10th–90th percentile · ${formatNumber(durationMs ?? 0, 0)} ms`}
        {status === "done" && result && ` · ${formatInitialState(result.initialState, model.hoursPerWeek)}`}
      </p>
    </section>
  );
}
