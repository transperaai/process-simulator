"use client";

import { useMemo } from "react";
import { ModelError, toEngineModel, type ProcessBundle } from "@transpera-flow/db";
import { useSimulation } from "@/lib/sim/use-simulation";
import { KpiStrip } from "./kpi-strip";
import { ProcessCanvas } from "./process-canvas";
import { UtilisationBars } from "./utilisation-bars";

export function ProcessView({ bundle }: { bundle: ProcessBundle }) {
  const resolved = useMemo(() => {
    try {
      return { model: toEngineModel(bundle), error: null };
    } catch (err) {
      if (err instanceof ModelError) return { model: null, error: err.message };
      throw err;
    }
  }, [bundle]);
  const sim = useSimulation(resolved.model);
  const result = sim.run?.result ?? null;

  if (!resolved.model) {
    return (
      <p role="alert" className="rounded-token border border-crit bg-crit-soft p-3">
        This process can&apos;t be simulated yet: {resolved.error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        model={resolved.model}
        currency={bundle.workspace.settings.currency}
        result={result}
        status={sim.status}
        durationMs={sim.run?.durationMs}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <ProcessCanvas bundle={bundle} result={result} />
        <UtilisationBars model={resolved.model} result={result} />
      </div>
    </div>
  );
}
