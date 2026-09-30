"use client";

import { useMemo } from "react";
import { ModelError, toEngineModel } from "@transpera-flow/db";
import type { EngineModel, SimulationResult } from "@transpera-flow/engine";
import type { RosterData } from "@/lib/clients/roster";
import { formatNumber, formatPercent, formatRange } from "@/lib/format";
import { clientRetention, type ClientRetention } from "@/lib/servicing";
import { useSimulation } from "@/lib/sim/use-simulation";

/**
 * The roster as this page shows it, simulated with the workspace's pipeline
 * and servicing processes (issue #19): each client's health over the horizon,
 * its touchpoints and its churn risk. Re-runs when the roster changes.
 */
export function useRosterRetention(data: RosterData): {
  model: EngineModel | null;
  result: SimulationResult | null;
  status: "running" | "done" | "error";
  byClient: Map<string, ClientRetention>;
} {
  const key = useMemo(() => {
    if (!data.simulation) return null;
    try {
      const model = toEngineModel({
        ...data.simulation,
        services: data.services,
        clients: data.clients,
        clientServices: data.clientServices,
        clientAssignments: data.clientAssignments,
        ...(data.servicingLinks ? { servicingLinks: data.servicingLinks } : {}),
      });
      return JSON.stringify(model);
    } catch (err) {
      if (err instanceof ModelError) return null;
      throw err;
    }
  }, [data]);
  const model = useMemo(() => (key ? (JSON.parse(key) as EngineModel) : null), [key]);
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;
  const byClient = useMemo(
    () => new Map(Object.entries(result?.clients ?? {}).map(([id, r]) => [id, clientRetention(r)])),
    [result],
  );
  return { model, result, status: sim.status, byClient };
}

const sectionClass = "mb-6 rounded-token border border-line bg-panel p-4 shadow-token";

/** Clients at risk, churn and touchpoints across the roster (docs/PRD.md §6.4, §13). */
export function RetentionPanel({
  retention,
  names,
}: {
  retention: ReturnType<typeof useRosterRetention>;
  names: Map<string, string>;
}) {
  const { model, result, status, byClient } = retention;
  if (!model) return null;
  const k = result?.kpi;
  const weeks = model.horizonWeeks;
  const whole = (v: number) => formatNumber(v, 0);
  const serviced = k?.touchpoints ? k.touchpoints.onTime.mean + k.touchpoints.late.mean + k.touchpoints.missed.mean > 0 : false;
  const worst = [...byClient.entries()].sort(([, a], [, b]) => a.end - b.end).slice(0, 5);
  return (
    <section className={sectionClass} aria-labelledby="retention-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="retention-heading" className="text-base font-bold">
          Simulated health and churn
        </h2>
        <p className="text-fg-3">
          The next {weeks} weeks, {result?.reps ?? 30} runs: servicing done on time lifts a client&apos;s health, late or missed work
          lowers it, and lower health raises churn.
          {status === "running" ? " Simulating…" : ""}
        </p>
      </div>
      {k && (
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label="Clients at risk" value={formatNumber(k.clientsAtRisk?.mean ?? 0)} detail={k.clientsAtRisk ? formatRange(k.clientsAtRisk, whole) : ""} crit={(k.clientsAtRisk?.mean ?? 0) >= 1} />
          <Figure label={`Churned / ${weeks} wks`} value={formatNumber(k.clientsChurned?.mean ?? 0)} detail={k.clientsChurned ? formatRange(k.clientsChurned, whole) : ""} />
          <Figure
            label="Touchpoints on time"
            value={serviced ? formatPercent(k.touchpoints!.onTime.mean / (k.touchpoints!.onTime.mean + k.touchpoints!.late.mean + k.touchpoints!.missed.mean)) : "–"}
            detail={serviced ? `${whole(k.touchpoints!.onTime.mean)} of ${whole(k.touchpoints!.onTime.mean + k.touchpoints!.late.mean + k.touchpoints!.missed.mean)}` : "no servicing processes linked"}
          />
          <Figure
            label="Late · missed"
            value={serviced ? `${whole(k.touchpoints!.late.mean)} · ${whole(k.touchpoints!.missed.mean)}` : "–"}
            detail="missed: not done within 2× SLA"
            crit={serviced && k.touchpoints!.missed.mean >= 1}
          />
        </dl>
      )}
      {worst.length > 0 && (
        <>
          <h3 className="mb-1 text-xs font-medium text-fg-2">Lowest simulated health at week {weeks}</h3>
          <ul className="flex flex-col gap-1">
            {worst.map(([id, r]) => (
              <li key={id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 sm:grid-cols-[14rem_1fr_auto]">
                <span className="truncate">{names.get(id) ?? "A client"}</span>
                <Sparkline values={r.trajectory} />
                <span className={`text-right text-xs tabular-nums ${r.atRisk ? "font-semibold text-crit" : "text-fg-2"}`}>
                  {formatNumber(r.start, 0)} → {formatNumber(r.end, 0)} · churn {formatNumber(r.churnMonthly * 100, 1)}%/mo
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Figure({ label, value, detail, crit }: { label: string; value: string; detail: string; crit?: boolean }) {
  return (
    <div className="min-w-0 rounded-token border border-line px-3 py-2">
      <dt className="font-mono text-[11px] uppercase tracking-widest text-fg-3">{label}</dt>
      <dd className={`truncate font-display text-xl font-bold tabular-nums ${crit ? "text-crit" : ""}`}>{value}</dd>
      <dd className="truncate text-xs text-fg-2 tabular-nums">{detail}&nbsp;</dd>
    </div>
  );
}

/** Weekly health with the at-risk line at 50, scaled to the values (and 50) so small moves show. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span />;
  const w = 120;
  const h = 20;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const lo = Math.max(0, Math.min(45, ...values) - 5);
  const hi = Math.min(100, Math.max(55, ...values) + 5);
  const y = (v: number) => h - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * h;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="order-last col-span-2 h-5 w-full sm:order-none sm:col-span-1" aria-hidden preserveAspectRatio="none">
      <line x1={0} x2={w} y1={y(50)} y2={y(50)} className="stroke-crit" strokeDasharray="2 2" strokeWidth={0.75} />
      <polyline points={points} fill="none" className="stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
