// Reads the editor makes to catch up (issue #10): which revisions a process
// has now, and one revision's rows. From the browser, as the signed-in user
// (RLS applies), rather than through Server Actions, which Next.js runs one
// at a time behind the editor's saves.

import type { Database, EdgeRow, StepRow } from "@transpera-flow/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftBackend, RevisionInfo } from "@/lib/drafts/session";
import { edgeFromRecord, stepFromRecord } from "./rows";

export function supabaseRevisionReader(db: SupabaseClient<Database>, processId: string): Required<Pick<DraftBackend, "revisions" | "rows">> {
  return {
    async revisions() {
      const { data: p, error } = await db.from("processes").select("live_revision_id, draft_revision_id").eq("id", processId).maybeSingle();
      if (error || !p?.live_revision_id) return null;
      const wanted = [p.live_revision_id, p.draft_revision_id].filter((id): id is string => !!id);
      const { data: revisions, error: rError } = await db.from("process_revisions").select("id, number").in("id", wanted);
      if (rError) return null;
      const info = (id: string | null): RevisionInfo | null => {
        const r = id ? revisions.find((x) => x.id === id) : undefined;
        return r ? { id: r.id, number: r.number } : null;
      };
      const live = info(p.live_revision_id);
      return live ? { live, draft: info(p.draft_revision_id) } : null;
    },
    async rows(revisionId) {
      const [steps, edges] = await Promise.all([
        db.from("steps").select("*").eq("revision_id", revisionId),
        db.from("edges").select("*").eq("revision_id", revisionId),
      ]);
      if (steps.error || edges.error) return null;
      return {
        steps: steps.data.map((r) => stepFromRecord(r as Record<string, unknown>)).filter((s): s is StepRow => s !== null),
        edges: edges.data.map((r) => edgeFromRecord(r as Record<string, unknown>)).filter((e): e is EdgeRow => e !== null),
      };
    },
  };
}
