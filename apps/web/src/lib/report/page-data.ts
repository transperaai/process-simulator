import "server-only";
import { changesSinceRun, listProcesses, loadProcessBundle, loadRuns, loadScenarios, ModelError, toEngineModel } from "@transpera-flow/db";
import { checkScenario } from "@transpera-flow/engine";
import { currentModel } from "@/lib/company-data";
import { retiredSteps } from "@/lib/scenarios/broken";
import { createClient } from "@/lib/supabase/server";

// What the Reports page shows (issue #28; docs/PRD.md §8 screen 12), as the
// signed-in user under RLS.

export interface BuilderScenario {
  id: string;
  name: string;
  description: string | null;
  /** Why it can't run (a deleted step, a person who left), or null. */
  needsAttention: string | null;
}

export interface BuilderRun {
  id: string;
  name: string;
  createdAt: string;
  reps: number;
  seed: number;
  /** Things changed in the model since; a report needs 0 to reproduce the run. */
  changes: number;
}

export interface StoredReport {
  id: string;
  title: string;
  createdAt: string;
  runId: string | null;
  hasPdf: boolean;
}

export interface ReportsPageData {
  workspace: { id: string; name: string; slug: string };
  canEdit: boolean;
  processes: { id: string; name: string }[];
  processId: string | null;
  modelError: string | null;
  scenarios: BuilderScenario[];
  runs: BuilderRun[];
  reports: StoredReport[];
}

export async function loadReportsPage(slug: string, processParam: string | null): Promise<ReportsPageData | null> {
  const supabase = await createClient();
  const { data: workspace, error } = await supabase.from("workspaces").select("id, name, slug, settings, provenance").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!workspace) return null;
  const head = { id: workspace.id, name: workspace.name, slug: workspace.slug };
  const canEdit = await supabase.rpc("can_edit_workspace", { ws: workspace.id });
  if (canEdit.error) throw canEdit.error;
  if (!canEdit.data) return { workspace: head, canEdit: false, processes: [], processId: null, modelError: null, scenarios: [], runs: [], reports: [] };

  const all = await listProcesses(supabase, workspace.id);
  const pipelines = all.filter((p) => p.kind !== "servicing" && p.live_revision_id);
  const asked = all.find((p) => p.id === processParam);
  const process = asked?.kind === "servicing" ? pipelines[0] : (pipelines.find((p) => p.id === asked?.id) ?? pipelines[0]);
  const [scenarioRows, runRows, reports, now] = await Promise.all([
    loadScenarios(supabase, workspace.id),
    loadRuns(supabase, workspace.id),
    supabase.from("reports").select("id, title, created_at, run_id, pdf_generated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(50),
    currentModel(supabase, workspace),
  ]);
  if (reports.error) throw reports.error;

  let scenarios: BuilderScenario[] = scenarioRows.map((s) => ({ id: s.id, name: s.name, description: s.description, needsAttention: null }));
  let modelError: string | null = null;
  if (process?.live_revision_id) {
    const bundle = await loadProcessBundle(supabase, workspace, process, process.live_revision_id);
    try {
      const model = toEngineModel(bundle);
      const retired = retiredSteps(bundle);
      scenarios = scenarioRows.map((s) => {
        const check = checkScenario(model, s.patch, retired);
        return { id: s.id, name: s.name, description: s.description, needsAttention: check.status === "ok" ? null : check.broken.map((b) => b.message).join(" ") };
      });
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      modelError = err.message;
    }
  }

  return {
    workspace: head,
    canEdit: true,
    processes: pipelines.map((p) => ({ id: p.id, name: p.name })),
    processId: process?.id ?? null,
    modelError,
    scenarios,
    runs: runRows
      .filter((r) => !process || r.process_id === process.id)
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, reps: r.reps, seed: r.seed, changes: changesSinceRun(r, now.snapshot).length })),
    reports: (reports.data ?? []).map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, runId: r.run_id, hasPdf: Boolean(r.pdf_generated_at) })),
  };
}
