"use server";

import { loadCompanyModel, loadLiveRevisions, snapshotModel, type Json } from "@transpera-flow/db";
import { parseSaveRun, type SaveRunResult } from "@/lib/runs/runs";
import { createClient } from "@/lib/supabase/server";

// Saving the run the process page shows (issue #25; docs/PRD.md §5 `runs`,
// D19). The server takes the model snapshot itself, as the signed-in user, so
// "model changed since this run" compares like with like. Editors, owners
// and agency admins may save runs (RLS).

export async function saveRun(input: unknown): Promise<SaveRunResult> {
  const parsed = parseSaveRun(input);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const run = parsed.value;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { status: "error", message: "Your session has ended. Sign in again." };

  const { data: process, error: pError } = await supabase.from("processes").select("id, workspace_id, is_company").eq("id", run.processId).maybeSingle();
  if (pError || !process) return { status: "error", message: "That process isn't available." };
  if (process.is_company) return { status: "error", message: "The company map can't be simulated: it is a picture of the business, not a process." };
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name, slug, settings, provenance")
    .eq("id", process.workspace_id)
    .maybeSingle();
  if (wsError || !workspace) return { status: "error", message: "That workspace isn't available." };

  const [model, processes] = await Promise.all([loadCompanyModel(supabase, workspace), loadLiveRevisions(supabase, workspace.id)]);
  if (processes.find((p) => p.id === run.processId)?.revision_id !== run.revisionId) {
    return { status: "error", message: "A newer revision of this process has been published. Reload the page to run it, then save." };
  }
  const { data, error } = await supabase
    .from("runs")
    .insert({
      workspace_id: workspace.id,
      process_id: run.processId,
      name: run.name,
      revision_ids: processes.map((p) => p.revision_id),
      reps: run.reps,
      seed: run.seed,
      params_snapshot: snapshotModel(model, processes) as unknown as Json,
      results: run.results as unknown as Json,
      duration_ms: run.durationMs,
      engine_version: run.engineVersion,
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: error.code === "42501" ? "You don't have permission to save runs here." : "Couldn't save the run. Try again." };
  return { status: "ok", id: data.id };
}
