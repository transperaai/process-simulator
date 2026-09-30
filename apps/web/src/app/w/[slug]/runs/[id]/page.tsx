import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { LiveExplainRun, type ExplanationView } from "@/components/narration";
import { EngineChangedNote, ModelChangedBanner, RunResultsTiles, RunSavedLine } from "@/components/runs-view";
import { canEditWorkspace } from "@/lib/access-data";
import { loadRunPage } from "@/lib/company-data";
import { narrationConfigured } from "@/lib/narration/anthropic";
import { cachedExplanation } from "@/lib/narration/explain";
import { createClient } from "@/lib/supabase/server";

/** One saved run, with "model changed since this run" and the list of changes (docs/PRD.md §4.1, D19), and "explain this run" (#29). */
export default async function RunPage(props: PageProps<"/w/[slug]/runs/[id]">) {
  const { slug, id } = await props.params;
  const data = await loadRunPage(slug, id);
  if (!data) notFound();
  const { run } = data;
  const supabase = await createClient();
  const processName = run.process_id ? ((await supabase.from("processes").select("name").eq("id", run.process_id).maybeSingle()).data?.name ?? "the process") : "the process";
  const [cached, canEdit] = await Promise.all([cachedExplanation(supabase, run, processName).catch(() => null), canEditWorkspace(run.workspace_id)]);
  const initial: ExplanationView | null = cached
    ? { source: cached.source, paragraphs: cached.paragraphs, fallback: cached.fallback, reason: cached.reason, cached: true, model: cached.model, checked: cached.checked, retried: cached.rejected.length > 0 }
    : null;
  return (
    <div>
      <ShellHeader title="Saved run" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 text-xl font-bold">{run.name}</h1>
        <div className="mb-3">
          <RunSavedLine run={run} />
        </div>
        <div className="flex flex-col gap-3">
          <ModelChangedBanner changes={data.changes} rerunHref={`/w/${slug}`} />
          <EngineChangedNote version={run.engine_version} />
          <RunResultsTiles results={run.results} />
          <LiveExplainRun runId={run.id} initial={initial} canDraft={canEdit} configured={narrationConfigured()} />
        </div>
      </div>
    </div>
  );
}
