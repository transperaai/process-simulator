import "server-only";
import { listProcesses, partitionSteps, type EdgeRow, type ProcessPart, type ProcessRevisionRow, type StepRow } from "@transpera-flow/db";
import { createClient } from "../supabase/server";

/**
 * Every process of the workspace at its live revision, for the Overview's company map (issue #100): the
 * pipelines, the servicing processes and the child processes, in creation order. Processes never published
 * aren't on the map. As the signed-in user (RLS decides what is visible).
 */
export async function loadLiveParts(workspaceId: string): Promise<ProcessPart[]> {
  const db = await createClient();
  const live = (await listProcesses(db, workspaceId)).filter((p) => p.live_revision_id);
  const ids = live.map((p) => p.live_revision_id!);
  if (!ids.length) return [];
  const [revisions, steps, edges] = await Promise.all([
    db.from("process_revisions").select("id, workspace_id, process_id, number, status").in("id", ids),
    db.from("steps").select("*").in("revision_id", ids),
    db.from("edges").select("*").in("revision_id", ids),
  ]);
  if (revisions.error) throw revisions.error;
  if (steps.error) throw steps.error;
  if (edges.error) throw edges.error;
  const parts: ProcessPart[] = [];
  for (const p of live) {
    const revision = (revisions.data as ProcessRevisionRow[]).find((r) => r.id === p.live_revision_id);
    if (!revision) continue;
    const { draft_revision_id, ...process } = p;
    void draft_revision_id;
    parts.push({
      process,
      revision,
      // Split or replaced steps are never drawn or simulated.
      steps: partitionSteps((steps.data as unknown as StepRow[]).filter((s) => s.revision_id === revision.id)).steps,
      edges: (edges.data as unknown as EdgeRow[]).filter((e) => e.revision_id === revision.id),
    });
  }
  return parts;
}
