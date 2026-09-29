"use client";

import { useState } from "react";
import type { EngineModel, SimulationResult, Stat } from "@transpera-flow/engine";
import { formatPercent, formatRange } from "@/lib/format";

const THRESHOLD = 0.85;
const pctWidth = (share: number) => `${Math.max(0, Math.min(100, share * 100))}%`;

interface Row {
  id: string;
  label: string;
  sublabel?: string;
  band?: { util: Stat; ongoing: Stat };
}

function Bar({ row, stacked }: { row: Row; stacked: boolean }) {
  const util = row.band?.util.mean ?? 0;
  const ongoing = row.band?.ongoing.mean ?? 0;
  const hot = util > THRESHOLD;
  return (
    <li
      className="grid grid-cols-[9.5rem_1fr_3rem] items-center gap-2"
      aria-label={row.band ? `${row.label}: ${formatPercent(util)} utilised, ${formatRange(row.band.util, formatPercent)}` : row.label}
    >
      {stacked ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate">{row.label}</span>
          {row.sublabel && <span className="block truncate text-xs text-fg-3">{row.sublabel}</span>}
        </span>
      ) : (
        <span className="truncate">
          {row.label} {row.sublabel && <span className="text-fg-3">{row.sublabel}</span>}
        </span>
      )}
      <span className="relative h-4" aria-hidden>
        <span className="absolute inset-x-0 top-0.5 h-3 overflow-hidden rounded-sm bg-panel-2">
          <span className="absolute inset-y-0 left-0 bg-fg-3/50" style={{ width: pctWidth(ongoing) }} />
          <span
            className={`absolute inset-y-0 ${hot ? "bg-crit" : "bg-accent"}`}
            style={{ left: pctWidth(ongoing), width: pctWidth(Math.min(1, util) - Math.min(1, ongoing)) }}
          />
        </span>
        {row.band && (
          <span
            className="absolute top-[7px] h-[2px] bg-fg"
            style={{ left: pctWidth(row.band.util.p10), width: pctWidth(row.band.util.p90 - row.band.util.p10) }}
          />
        )}
        <span className="absolute inset-y-0 w-px bg-fg" style={{ left: pctWidth(THRESHOLD) }} />
      </span>
      <span className={`text-right tabular-nums ${hot ? "font-semibold text-crit" : ""}`}>
        {row.band ? formatPercent(util) : "–"}
      </span>
    </li>
  );
}

export function UtilisationBars({ model, result }: { model: EngineModel; result: SimulationResult | null }) {
  const [view, setView] = useState<"roles" | "people">("roles");

  const roleRows: Row[] = Object.entries(model.roles).map(([id, role]) => {
    const members = result ? Object.values(result.resolvedPeople).filter((p) => p.roles.includes(id)).length : role.count;
    return { id, label: role.name, sublabel: `× ${members}`, band: result?.kpi.roles[id] };
  });
  // People grouped by their first role, in role order.
  const roleOrder = Object.keys(model.roles);
  const personRows: Row[] = result
    ? Object.entries(result.resolvedPeople)
        .sort(([, a], [, b]) => roleOrder.indexOf(a.roles[0] ?? "") - roleOrder.indexOf(b.roles[0] ?? "") || a.name.localeCompare(b.name))
        .map(([id, p]) => ({
          id,
          label: p.name,
          sublabel: p.roles.map((r) => model.roles[r]?.name).filter(Boolean).join(", "),
          band: result.kpi.people[id],
        }))
    : [];
  const rows = view === "roles" ? roleRows : personRows;

  return (
    <section aria-labelledby="util-heading" className="rounded-token border border-line bg-panel p-3 shadow-token">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="util-heading" className="text-sm font-bold">
          Utilisation
        </h2>
        <div role="group" aria-label="Show utilisation by" className="flex rounded-token border border-line-2 p-0.5 text-xs">
          {(["roles", "people"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-0.5 capitalize ${view === v ? "bg-accent text-accent-fg" : "text-fg-2 hover:bg-panel-2"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <Bar key={row.id} row={row} stacked={view === "people"} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-fg-3">
        Grey: ongoing client work · colour: pipeline · dark line: 10th–90th percentile range · tick: 85% ceiling
      </p>
    </section>
  );
}
