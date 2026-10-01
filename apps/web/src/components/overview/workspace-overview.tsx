import Link from "next/link";
import { notFound } from "next/navigation";
import { Overview } from "@/components/overview/overview";
import { ShellHeader } from "@/components/shell/shell-header";
import { loadLiveProcess, loadWorkspaceHead, loadWorkspaceIssues, loadWorkspaceOverview } from "@/lib/data";
import { loadLiveParts } from "@/lib/overview/data";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";

/** The Overview of a workspace (issue #100): the landing page, at `/w/[slug]` and `/w/[slug]/overview`. */
export async function WorkspaceOverview({ slug }: { slug: string }) {
  const live = await loadLiveProcess(slug);
  if (!live) {
    const head = await loadWorkspaceHead(slug);
    if (!head) notFound();
    const overview = await loadWorkspaceOverview(slug);
    return <EmptyOverview slug={slug} name={head.name} unpublished={overview?.processes ?? []} />;
  }
  const ws = live.workspace.id;
  const [parts, issues, rules] = await Promise.all([loadLiveParts(ws), loadWorkspaceIssues(ws), loadWorkspaceAnalysisRules(ws)]);
  const base = `/w/${slug}`;
  return (
    <Overview
      workspaceName={live.workspace.name}
      live={live}
      parts={parts}
      issues={issues}
      mode="live"
      analysisRules={rules.settings}
      hrefs={Object.fromEntries(parts.map((p) => [p.process.id, `${base}/p/${p.process.id}`]))}
      processesHref={`${base}/processes`}
      issuesHref={`${base}/issues`}
      rulesHref={`${base}/settings/rules`}
    />
  );
}

/** A workspace with no published process (a new one): what to do next, where the Overview will be. */
function EmptyOverview({ slug, name, unpublished }: { slug: string; name: string; unpublished: { id: string; name: string; draft: boolean }[] }) {
  const base = `/w/${slug}`;
  return (
    <div>
      <ShellHeader title="Overview" />
      <section className="mx-auto mt-6 w-full max-w-3xl rounded-token border border-dashed border-line p-6">
        <h1 className="text-base font-bold">{name} has no published process yet</h1>
        <p className="mt-2 text-fg-2">The Overview shows the company map, headline numbers and trends once a process is published.</p>
        {unpublished.length > 0 && (
          <>
            <p className="mt-3 text-fg-2">These haven&apos;t been published yet:</p>
            <ul className="mt-1 list-disc pl-5">
              {unpublished.map((p) => (
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
