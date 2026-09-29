import type { EngineModel, SimulationResult } from "@flowsim/engine";
import { formatPercent } from "@/lib/format";

const THRESHOLD = 0.85;

export function UtilisationBars({ model, result }: { model: EngineModel; result: SimulationResult | null }) {
  return (
    <section aria-labelledby="util-heading" className="rounded-token border border-line bg-panel p-3 shadow-token">
      <h2 id="util-heading" className="mb-2 text-sm font-bold">
        Utilisation by role
      </h2>
      <ul className="flex flex-col gap-2">
        {Object.entries(model.roles).map(([id, role]) => {
          const r = result?.roles[id];
          const util = r?.util ?? 0;
          return (
            <li key={id} className="grid grid-cols-[9.5rem_1fr_3rem] items-center gap-2">
              <span className="truncate">
                {role.name} <span className="text-fg-3">× {role.count}</span>
              </span>
              <span className="relative h-3 overflow-hidden rounded-sm bg-panel-2" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 bg-fg-3/50"
                  style={{ width: `${Math.min(100, (r?.ongoing ?? 0) * 100)}%` }}
                />
                <span
                  className={`absolute inset-y-0 ${util > THRESHOLD ? "bg-crit" : "bg-accent"}`}
                  style={{
                    left: `${Math.min(100, (r?.ongoing ?? 0) * 100)}%`,
                    width: `${Math.max(0, Math.min(100, util * 100) - Math.min(100, (r?.ongoing ?? 0) * 100))}%`,
                  }}
                />
                <span className="absolute inset-y-0 w-px bg-fg" style={{ left: `${THRESHOLD * 100}%` }} />
              </span>
              <span className={`text-right tabular-nums ${util > THRESHOLD ? "font-semibold text-crit" : ""}`}>
                {r ? formatPercent(util) : "–"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-3">Grey: ongoing client work · colour: pipeline · line: 85% ceiling</p>
    </section>
  );
}
