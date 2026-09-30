import { NORTHBEAM_WORKSPACE_ID, northbeamBundle, runResults, toEngineModel, type RunRow } from "@transpera-flow/db";
import { ENGINE_VERSION, simulate } from "@transpera-flow/engine";
import { ShellHeader } from "@/components/shell/shell-header";
import { DemoRuns } from "@/components/demo-runs";
import { demoBaselineSnapshot } from "@/lib/suggestions/demo";

/** Saved runs on the demo: a baseline saved before some of the model changed, and runs saved on /demo in this tab. */
export default function DemoRunsPage() {
  const bundle = northbeamBundle();
  const model = toEngineModel(bundle, { startDate: "2026-09-28" });
  const baseline: RunRow = {
    id: "5a000000-0000-4000-8000-0000000000b1",
    workspace_id: NORTHBEAM_WORKSPACE_ID,
    process_id: bundle.process.id,
    name: "Audit baseline",
    scenario_id: null,
    revision_ids: [bundle.revision.id],
    engine_version: ENGINE_VERSION,
    reps: 30,
    seed: 1,
    params_snapshot: demoBaselineSnapshot(),
    results: runResults(model, simulate(model, 30, 1), bundle.workspace.settings.currency),
    duration_ms: null,
    created_at: "2026-09-28T16:30:00.000Z",
    created_by: null,
  };
  return (
    <div>
      <ShellHeader title="Runs" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Saved runs</h1>
        <p className="mb-4 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
          Demo mode: “Audit baseline” was saved two days before overtime was allowed, Harbour Lane&apos;s fee went up, Google Ads grew and Chloe
          joined, so it shows what changed since. Accept suggestions or save a run on the process page and come back: changes stay in this tab
          and are gone when you reload.
        </p>
        <DemoRuns baseline={baseline} processName={bundle.process.name} />
      </div>
    </div>
  );
}
