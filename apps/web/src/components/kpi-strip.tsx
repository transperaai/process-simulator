import type { EngineModel, SimulationResult } from "@flowsim/engine";
import { formatDays, formatNumber, formatPercent } from "@/lib/format";

interface KpiStripProps {
  model: EngineModel;
  result: SimulationResult | null;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export function KpiStrip({ model, result, status, durationMs }: KpiStripProps) {
  const bn = result?.bnRole ? model.roles[result.bnRole] : null;
  const bnUtil = result?.bnRole ? result.roles[result.bnRole]?.util : undefined;
  const tiles = [
    {
      label: `Wins / ${model.horizonWeeks} wks`,
      value: result ? formatNumber(result.won) : "–",
      detail: result ? `range ${result.wonLow}–${result.wonHigh}` : "",
    },
    { label: "Lost", value: result ? formatNumber(result.lost, 0) : "–", detail: "" },
    {
      label: "Cycle time",
      value: result ? formatDays(result.cycleP50, model.hoursPerWeek) : "–",
      detail: result ? `P50 · P90 ${formatDays(result.cycleP90, model.hoursPerWeek)}` : "",
    },
    {
      label: "Bottleneck",
      value: bn?.name ?? "–",
      detail: bnUtil !== undefined ? `${formatPercent(bnUtil)} utilised` : "",
      tone: bnUtil !== undefined && bnUtil > 0.85 ? "crit" : undefined,
    },
  ];
  return (
    <section aria-label="Key results" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-token border border-line bg-panel px-3 py-2 shadow-token">
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
            : `${result?.reps} replications · ${formatNumber(durationMs ?? 0, 0)} ms`}
      </p>
    </section>
  );
}
