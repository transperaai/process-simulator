"use client";

import { useMemo, useState } from "react";
import { changesSinceRun, snapshotModel, type RunRow } from "@transpera-flow/db";
import { explainDemoRun } from "@/app/demo/runs/actions";
import { useDemoCompany } from "@/lib/demo/company-store";
import { demoProcesses } from "@/lib/suggestions/demo";
import { ExplainRun } from "./narration";
import { EngineChangedNote, ModelChangedBanner, RunResultsTiles, RunSavedLine, RunsTable } from "./runs-view";

/** The demo's saved runs: the sample baseline and any saved on /demo in this tab, compared with the demo's model now. */
export function DemoRuns({ baseline, processName }: { baseline: RunRow; processName: string }) {
  const demo = useDemoCompany();
  const runs = useMemo(() => [...demo.runs, baseline], [demo.runs, baseline]);
  const now = useMemo(() => snapshotModel(demo.model, demoProcesses()), [demo.model]);
  const [open, setOpen] = useState(runs[0]!.id);
  const run = runs.find((r) => r.id === open) ?? runs[0]!;
  const changes = changesSinceRun(run, now);
  return (
    <div className="flex flex-col gap-4">
      <RunsTable runs={runs.map((r) => ({ ...r, changes: changesSinceRun(r, now).length }))} onOpen={setOpen} />
      <section aria-labelledby="run-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="run-heading" className="text-lg font-bold">
            {run.name}
          </h2>
          <RunSavedLine run={run} />
        </div>
        <ModelChangedBanner changes={changes} rerunHref="/demo" />
        <EngineChangedNote version={run.engine_version} />
        <RunResultsTiles results={run.results} />
        <ExplainRun
          key={run.id}
          initial={null}
          canDraft
          configured
          request={() => explainDemoRun({ id: run.id, name: run.name, created_at: run.created_at, results: run.results }, processName)}
          note="Demo: written by a stand-in that composes prose from the run's figures and goes through the same number check as Claude. The public demo never calls the Anthropic API."
        />
      </section>
    </div>
  );
}
