"use client";

// The bottleneck panel (docs/PRD.md §6.4 "Bottleneck"; issue #26): the top
// constraint with the numbers behind it, where work queues longest, and the
// shadow price: extra completions a quarter from one more full-time person in
// the bottleneck role, from an extra replication set paired with the baseline.
// The same engine functions back MCP `get_bottlenecks`, so both say the same.

import { useMemo } from "react";
import { rankBottlenecks, shadowPriceText, type Bottlenecks, type EngineModel, type SimulationResult, type Stat } from "@transpera-flow/engine";
import { useShadowPrice, type ShadowState } from "@/lib/sim/shadow-price";
import { formatNumber } from "@/lib/format";

const MINUS = "−";
const signed = (v: number) => {
  const s = formatNumber(Math.abs(v), 1);
  return s === "0" ? "0" : `${v > 0 ? "+" : MINUS}${s}`;
};
const range = (s: Stat) => (signed(s.p10) === signed(s.p90) ? signed(s.p10) : `${signed(s.p10)} to ${signed(s.p90)}`);

export function BottleneckPanel({
  model,
  result,
  ready,
  reps = 30,
  seed = 1,
}: {
  model: EngineModel;
  /** The baseline run of `model`. */
  result: SimulationResult | null;
  /** Whether `result` is up to date with `model` (the shadow price pairs with it). */
  ready: boolean;
  reps?: number;
  seed?: number;
}) {
  const ranked = useMemo(() => (result ? rankBottlenecks(model, result, { limit: 3 }) : null), [model, result]);
  const shadow = useShadowPrice(ready ? model : null, ready ? (ranked?.top?.id ?? null) : null, reps, seed);
  return <BottleneckView ranked={ranked} shadow={shadow} reps={reps} />;
}

/** The panel's content, given the ranking and the shadow price's state. */
export function BottleneckView({ ranked, shadow, reps }: { ranked: Bottlenecks | null; shadow: ShadowState; reps: number }) {
  const top = ranked?.top ?? null;
  const sp = shadow.status === "done" ? shadow.value : null;
  return (
    <section aria-labelledby="bottleneck-heading" data-testid="bottleneck-panel" className="rounded-token border border-line bg-panel p-3 shadow-token">
      <h2 id="bottleneck-heading" className="mb-2 text-sm font-bold">
        Bottleneck
      </h2>
      {!top ? (
        <p className="text-sm text-fg-2">{ranked ? "No role limits this process." : "Simulating…"}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>{top.evidence}</p>
          {ranked?.steps[0] && <p className="text-fg-2">{ranked.steps[0].evidence}</p>}
          <div className="rounded-token border border-accent/40 bg-accent-soft px-3 py-2" aria-live="polite">
            <p className="font-mono text-[11px] uppercase tracking-widest text-fg-3">Shadow price · +1 {top.name}</p>
            {sp ? (
              <>
                <p data-testid="shadow-price" className="font-display text-xl font-bold tabular-nums">
                  {signed(sp.perQuarter.mean)} <span className="text-sm font-normal">completions / quarter</span>
                </p>
                <p className="text-xs text-fg-2 tabular-nums">range {range(sp.perQuarter)}</p>
                <p className="mt-1 text-xs text-fg-2">{shadowPriceText(sp, top.name)}</p>
              </>
            ) : shadow.status === "error" ? (
              <p className="text-xs text-crit">Couldn&apos;t price it: {shadow.error}</p>
            ) : (
              <p className="text-xs text-fg-3">Running {reps} extra replications with one more full-time {top.name}…</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
