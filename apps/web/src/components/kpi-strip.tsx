import type { EngineModel, SimulationResult } from "@transpera-flow/engine";
import { formatCurrency, formatDays, formatNumber, formatPercent, formatRange } from "@/lib/format";

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
  tone?: "crit";
}

export function KpiStrip({ model, currency, result, status, durationMs }: KpiStripProps) {
  const k = result?.kpi;
  const whole = (v: number) => formatNumber(v, 0);
  const days = (h: number) => formatDays(h, model.hoursPerWeek);
  const money = (v: number) => formatCurrency(v, currency);
  const bnId = result?.bnRole ?? null;
  const bn = bnId ? k?.roles[bnId] : undefined;

  const tiles: Tile[] = [
    {
      label: `Wins / ${model.horizonWeeks} wks`,
      value: k ? formatNumber(k.won.mean) : "–",
      detail: k ? formatRange(k.won, whole) : "",
    },
    { label: "Lost", value: k ? whole(k.lost.mean) : "–", detail: k ? formatRange(k.lost, whole) : "" },
    {
      label: "Cycle time",
      value: k ? days(k.cycle.mean) : "–",
      detail: k ? `P50 ${days(k.cycle.p50)} · P90 ${days(k.cycle.p90)}` : "",
    },
    { label: "New MRR", value: k ? money(k.mrrAdded.mean) : "–", detail: k ? formatRange(k.mrrAdded, money) : "" },
    {
      label: "Bottleneck",
      value: bnId ? (model.roles[bnId]?.name ?? "–") : "–",
      detail: bn ? `${formatPercent(bn.util.mean)} utilised · ${formatRange(bn.util, formatPercent)}` : "",
      tone: bn && bn.util.mean > 0.85 ? "crit" : undefined,
    },
  ];

  return (
    <section aria-label="Key results" className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {tiles.map((t, i) => (
        <div
          key={t.label}
          className={`rounded-token border border-line bg-panel px-3 py-2 shadow-token ${i === tiles.length - 1 ? "col-span-2 md:col-span-1" : ""}`}
        >
          <p className="font-mono text-[11px] uppercase tracking-widest text-fg-3">{t.label}</p>
          <p className={`font-display text-xl font-bold tabular-nums ${t.tone === "crit" ? "text-crit" : ""}`}>{t.value}</p>
          <p className="text-xs text-fg-2 tabular-nums">{t.detail}&nbsp;</p>
        </div>
      ))}
      <p role="status" aria-live="polite" className="col-span-full text-xs text-fg-3">
        {status === "running"
          ? "Simulating…"
          : status === "error"
            ? "Simulation failed"
            : `Average of ${result?.reps} replications; ranges are the 10th–90th percentile · ${formatNumber(durationMs ?? 0, 0)} ms`}
      </p>
    </section>
  );
}
