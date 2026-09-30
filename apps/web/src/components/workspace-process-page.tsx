import Link from "next/link";
import { notFound } from "next/navigation";
import { createServicingProcess } from "@/app/w/[slug]/process-actions";
import { AppHeader } from "@/components/app-header";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, canManageWorkspace, currentViewer } from "@/lib/access-data";
import { pendingSuggestionCount } from "@/lib/company-data";
import { loadProcessForEditing, loadWorkspaceIssues, loadWorkspaceOverview, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

/**
 * A process of the workspace on the canvas: `/w/[slug]` (the first published
 * process) and `/w/[slug]/p/[processId]` (any process, never-published ones
 * included; issue #76).
 */
export async function WorkspaceProcessPage({ slug, processId, fix }: { slug: string; processId?: string; fix: string | null }) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) {
    // A workspace nothing is published in (a new one) still opens: its links and how to get started.
    const overview = processId ? null : await loadWorkspaceOverview(slug);
    if (!overview) notFound();
    return <EmptyWorkspace slug={slug} overview={overview} />;
  }
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
        {canEdit && (
          <Link href={`${base}/reports?process=${live.process.id}`} className="text-fg-2 hover:underline">
            Report
          </Link>
        )}
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

const linkClass = "text-fg-2 hover:underline";

/** A workspace with no published process: the same links as the canvas page, and what to do next (issue #88). */
async function EmptyWorkspace({ slug, overview }: { slug: string; overview: NonNullable<Awaited<ReturnType<typeof loadWorkspaceOverview>>> }) {
  const { workspace, processes } = overview;
  const [canManage, pendingSuggestions] = await Promise.all([canManageWorkspace(workspace.id), pendingSuggestionCount(workspace.id)]);
  const base = `/w/${slug}`;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={workspace.name} signedIn />
      <div className="mt-4 mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold">{workspace.name}</h1>
        <Link href={`${base}/issues`} className={linkClass}>
          Issues
        </Link>
        <Link href={`${base}/clients`} className={linkClass}>
          Clients
        </Link>
        <Link href={`${base}/sources`} className={linkClass}>
          Sources
        </Link>
        <Link href={`${base}/suggestions`} className={linkClass}>
          Suggestions
          {pendingSuggestions > 0 && (
            <span className="ml-1 rounded-full border border-warn bg-warn-soft px-1.5 text-[11px] font-semibold tabular-nums">{pendingSuggestions}</span>
          )}
        </Link>
        <Link href={`${base}/runs`} className={linkClass}>
          Runs
        </Link>
        <Link href={`${base}/settings`} className={linkClass}>
          People &amp; settings
        </Link>
        {canManage && (
          <Link href={`${base}/settings/access`} className={linkClass}>
            Access
          </Link>
        )}
      </div>
      <section className="rounded-token border border-dashed border-line p-6">
        <h2 className="text-base font-bold">No published process yet</h2>
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
    </main>
  );
}
