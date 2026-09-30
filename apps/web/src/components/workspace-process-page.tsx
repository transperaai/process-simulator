import Link from "next/link";
import { notFound } from "next/navigation";
import { createServicingProcess } from "@/app/w/[slug]/process-actions";
import { AppHeader } from "@/components/app-header";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, canManageWorkspace, currentViewer } from "@/lib/access-data";
import { pendingSuggestionCount } from "@/lib/company-data";
import { loadProcessForEditing, loadWorkspaceIssues, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

/**
 * A process of the workspace on the canvas: `/w/[slug]` (the first published
 * process) and `/w/[slug]/p/[processId]` (any process, never-published ones
 * included; issue #76).
 */
export async function WorkspaceProcessPage({ slug, processId, fix }: { slug: string; processId?: string; fix: string | null }) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) notFound();
  const { live, draft, processes } = process;
  const [canEdit, canManage, scenarios, issues, viewer, sources, pendingSuggestions] = await Promise.all([
    canEditWorkspace(live.workspace.id),
    canManageWorkspace(live.workspace.id),
    loadWorkspaceScenarios(live.workspace.id),
    loadWorkspaceIssues(live.workspace.id),
    currentViewer(),
    loadWorkspaceSources(live.workspace.id),
    pendingSuggestionCount(live.workspace.id),
  ]);
  const base = `/w/${slug}`;
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, `${base}/p/${p.id}`]));
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={live.workspace.name} signedIn />
      <div className="mt-4 mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold">{live.process.name}</h1>
        <Link href={`${base}/issues`} className="text-fg-2 hover:underline">
          Issues
        </Link>
        <Link href={`${base}/clients`} className="text-fg-2 hover:underline">
          Clients
        </Link>
        <Link href={`${base}/sources`} className="text-fg-2 hover:underline">
          Sources
        </Link>
        <Link href={`${base}/suggestions`} className="text-fg-2 hover:underline">
          Suggestions
          {pendingSuggestions > 0 && (
            <span className="ml-1 rounded-full border border-warn bg-warn-soft px-1.5 text-[11px] font-semibold tabular-nums">{pendingSuggestions}</span>
          )}
        </Link>
        <Link href={`${base}/runs`} className="text-fg-2 hover:underline">
          Runs
        </Link>
        <Link href={`${base}/settings`} className="text-fg-2 hover:underline">
          People &amp; settings
        </Link>
        {canManage && (
          <Link href={`${base}/settings/access`} className="text-fg-2 hover:underline">
            Access
          </Link>
        )}
      </div>
      {(processes.length > 1 || canEdit) && (
        <ProcessNav
          processes={processes}
          current={live.process.id}
          hrefs={hrefs}
          create={canEdit ? createServicingProcess.bind(null, live.workspace.id, slug) : undefined}
        />
      )}
      <ProcessView
        key={live.process.id}
        live={live}
        draft={draft}
        mode={canEdit ? "live" : "readonly"}
        scenarios={scenarios}
        issues={issues}
        sources={sources}
        initialFix={fix}
        registerHref={`${base}/issues`}
        settingsHref={`${base}/settings`}
        userId={viewer?.userId ?? null}
        viewer={viewer}
      />
    </main>
  );
}
