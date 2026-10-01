import Link from "next/link";
import { notFound } from "next/navigation";
import { createServicingProcess } from "@/app/w/[slug]/process-actions";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { ShellHeader } from "@/components/shell/shell-header";
import { canEditWorkspace, currentViewer } from "@/lib/access-data";
import { loadWorkspaceLeverSettings } from "@/lib/levers/data";
import { processRatings } from "@/lib/processes/rows";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";
import { loadProcessForEditing, loadWorkspaceIssues, loadWorkspaceOverview, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

/**
 * A process of the workspace on the canvas: `/w/[slug]` (the first published
 * process) and `/w/[slug]/p/[processId]` (any process, never-published ones
 * included; issue #76).
 */
export async function WorkspaceProcessPage({ slug, processId }: { slug: string; processId?: string }) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) {
    // A workspace nothing is published in (a new one) still opens: its links and how to get started.
    const overview = processId ? null : await loadWorkspaceOverview(slug);
    if (!overview) notFound();
    return <EmptyWorkspace slug={slug} overview={overview} />;
  }
  const { live, draft, processes } = process;
  const [canEdit, scenarios, issues, viewer, sources, rules, levers] = await Promise.all([
    canEditWorkspace(live.workspace.id),
    loadWorkspaceScenarios(live.workspace.id),
    loadWorkspaceIssues(live.workspace.id),
    currentViewer(),
    loadWorkspaceSources(live.workspace.id),
    loadWorkspaceAnalysisRules(live.workspace.id),
    loadWorkspaceLeverSettings(live.workspace.id),
  ]);
  const base = `/w/${slug}`;
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, `${base}/p/${p.id}`]));
  return (
    <ProcessView
      key={live.process.id}
      live={live}
      draft={draft}
      mode={canEdit ? "live" : "readonly"}
      scenarios={scenarios}
      issues={issues}
      sources={sources}
      analysisRules={rules.settings}
      hiddenLevers={levers.hidden}
      registerHref={`${base}/issues`}
      settingsHref={`${base}/settings`}
      editHref={canEdit ? `${base}/p/${live.process.id}/edit` : undefined}
      userId={viewer?.userId ?? null}
      viewer={viewer}
      processPicker={
        <ProcessNav
          processes={processes}
          current={live.process.id}
          hrefs={hrefs}
          create={canEdit ? createServicingProcess.bind(null, live.workspace.id, slug) : undefined}
          ratings={processRatings(processes, issues, [...live.steps, ...(live.otherProcesses ?? []).flatMap((p) => p.steps)])}
          processesHref={`${base}/processes`}
          companyMapHref={base}
        />
      }
    />
  );
}

/** A workspace with no published process: what to do next (issue #88). The sidebar has the links. */
function EmptyWorkspace({ slug, overview }: { slug: string; overview: NonNullable<Awaited<ReturnType<typeof loadWorkspaceOverview>>> }) {
  const { processes } = overview;
  const base = `/w/${slug}`;
  return (
    <div>
      <ShellHeader title={overview.workspace.name} />
      <section className="mx-auto mt-6 w-full max-w-3xl rounded-token border border-dashed border-line p-6">
        <h1 className="text-base font-bold">No published process yet</h1>
        {processes.length > 0 && (
          <>
            <p className="mt-2 text-fg-2">These haven&apos;t been published yet:</p>
            <ul className="mt-1 list-disc pl-5">
              {processes.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/p/${p.id}`} className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  {p.draft && <span className="ml-2 text-fg-3">has a draft</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-fg-2">
          To get started, add roles under{" "}
          <Link href={`${base}/settings`} className="underline">
            People &amp; settings
          </Link>
          , then import a process with Claude (<code>set_active_workspace</code>, then <code>import_process</code>). Create a token under{" "}
          <Link href="/settings/tokens" className="underline">
            API tokens
          </Link>{" "}
          to connect it.
        </p>
      </section>
    </div>
  );
}
