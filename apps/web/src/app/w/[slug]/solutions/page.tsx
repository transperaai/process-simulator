import { notFound } from "next/navigation";
import { NewSolutionButton, SolutionsList } from "@/components/solutions/solutions-list";
import { Page } from "@/components/shell/page";
import { canEditWorkspace, currentUserId } from "@/lib/access-data";
import { loadLiveProcess, loadProcessNames, loadWorkspaceIssues, loadWorkspaceLiveRevisionIds, loadWorkspaceSolutions } from "@/lib/data";

/** The Solutions list (A50): every solution built and simulated, with the issues each solves and how it did. */
export default async function WorkspaceSolutionsPage(props: PageProps<"/w/[slug]/solutions">) {
  const { slug } = await props.params;
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  const ws = bundle.workspace.id;
  const [canEdit, viewerId, solutions, issues, processes, live] = await Promise.all([
    canEditWorkspace(ws),
    currentUserId(),
    loadWorkspaceSolutions(ws),
    loadWorkspaceIssues(ws),
    loadProcessNames(ws),
    loadWorkspaceLiveRevisionIds(ws),
  ]);
  const base = `/w/${slug}`;
  return (
    <Page
      title="Solutions"
      eyebrow="Improve"
      description="Every solution that has been built and simulated. Each one says which issues it solves, and how it did against each issue's target. They never change the live map."
      actions={canEdit ? <NewSolutionButton processes={processes.filter((p) => live[p.id])} base={base} /> : undefined}
    >
      <SolutionsList data={solutions} issues={issues} processes={processes} base={base} mode={canEdit ? "live" : "readonly"} viewerId={viewerId} />
    </Page>
  );
}
