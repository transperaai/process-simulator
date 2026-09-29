import type { EngineModel, SimulationResult } from "@flowsim/engine";
import { formatPercent, formatRange } from "@/lib/format";

const THRESHOLD = 0.85;
const pctWidth = (share: number) => `${Math.max(0, Math.min(100, share * 100))}%`;

export function UtilisationBars({ model, result }: { model: EngineModel; result: SimulationResult | null }) {
  return (
    <section aria-labelledby="util-heading" className="rounded-token border border-line bg-panel p-3 shadow-token">
      <h2 id="util-heading" className="mb-2 text-sm font-bold">
        Utilisation by role
      </h2>
      <ul className="flex flex-col gap-2">
        {Object.entries(model.roles).map(([id, role]) => {
          const band = result?.kpi.roles[id];
          const util = band?.util.mean ?? 0;
          const ongoing = band?.ongoing.mean ?? 0;
          const hot = util > THRESHOLD;
          return (
            <li
              key={id}
              className="grid grid-cols-[9.5rem_1fr_3rem] items-center gap-2"
              aria-label={band ? `${role.name}: ${formatPercent(util)} utilised, ${formatRange(band.util, formatPercent)}` : role.name}
            >
              <span className="truncate">
                {role.name} <span className="text-fg-3">× {role.count}</span>
              </span>
              <span className="relative h-4" aria-hidden>
                <span className="absolute inset-x-0 top-0.5 h-3 overflow-hidden rounded-sm bg-panel-2">
                  <span className="absolute inset-y-0 left-0 bg-fg-3/50" style={{ width: pctWidth(ongoing) }} />
                  <span
                    className={`absolute inset-y-0 ${hot ? "bg-crit" : "bg-accent"}`}
                    style={{ left: pctWidth(ongoing), width: pctWidth(Math.min(1, util) - Math.min(1, ongoing)) }}
                  />
                </span>
                {band && (
                  <span
                    className="absolute top-[7px] h-[2px] bg-fg"
                    style={{ left: pctWidth(band.util.p10), width: pctWidth(band.util.p90 - band.util.p10) }}
                  />
                )}
                <span className="absolute inset-y-0 w-px bg-fg" style={{ left: pctWidth(THRESHOLD) }} />
              </span>
              <span className={`text-right tabular-nums ${hot ? "font-semibold text-crit" : ""}`}>
                {band ? formatPercent(util) : "–"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-3">
        Grey: ongoing client work · colour: pipeline · dark line: 10th–90th percentile range · tick: 85% ceiling
      </p>
    </section>
  );
}
