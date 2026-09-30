import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, canManageWorkspace, currentViewer } from "@/lib/access-data";
import { loadProcessForEditing, loadWorkspaceIssues, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const { fix } = await props.searchParams;
  const process = await loadProcessForEditing(slug);
  if (!process) notFound();
  const { live, draft } = process;
  const [canEdit, canManage, scenarios, issues, viewer, sources] = await Promise.all([
    canEditWorkspace(live.workspace.id),
    canManageWorkspace(live.workspace.id),
    loadWorkspaceScenarios(live.workspace.id),
    loadWorkspaceIssues(live.workspace.id),
    currentViewer(),
    loadWorkspaceSources(live.workspace.id),
  ]);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={live.workspace.name} signedIn />
      <div className="mt-4 mb-3 flex items-baseline gap-4">
        <h1 className="text-xl font-bold">{live.process.name}</h1>
        <Link href={`/w/${slug}/issues`} className="text-fg-2 hover:underline">
          Issues
        </Link>
        <Link href={`/w/${slug}/clients`} className="text-fg-2 hover:underline">
          Clients
        </Link>
        <Link href={`/w/${slug}/sources`} className="text-fg-2 hover:underline">
          Sources
        </Link>
        <Link href={`/w/${slug}/settings`} className="text-fg-2 hover:underline">
          People &amp; settings
        </Link>
        {canManage && (
          <Link href={`/w/${slug}/settings/access`} className="text-fg-2 hover:underline">
            Access
          </Link>
        )}
      </div>
      <ProcessView
        live={live}
        draft={draft}
        mode={canEdit ? "live" : "readonly"}
        scenarios={scenarios}
        issues={issues}
        sources={sources}
        initialFix={typeof fix === "string" ? fix : null}
        registerHref={`/w/${slug}/issues`}
        userId={viewer?.userId ?? null}
        viewer={viewer}
      />
    </main>
  );
}
