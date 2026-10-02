import { notFound } from "next/navigation";
import { SolutionPage } from "@/components/solutions/solution-page";
import { Page } from "@/components/shell/page";
import { canEditWorkspace, currentUserId } from "@/lib/access-data";
import { loadLiveProcess, loadProcessNames, loadWorkspaceIssues, loadWorkspaceSolutions } from "@/lib/data";
import { isId } from "@/lib/sources/validate";

/**
 * One solution (A50, slice 1): the issues it solves with a verdict each, your own verdicts and notes. `[id]` is the solution's id.
 * The maps side by side, the measures, the MRR chart and the market stress test come in slice 2.
 */
export default async function WorkspaceSolutionPage(props: PageProps<"/w/[slug]/solutions/[id]">) {
  const { slug, id } = await props.params;
  if (!isId(id)) notFound();
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  const ws = bundle.workspace.id;
  const [canEdit, viewerId, solutions, issues, processes] = await Promise.all([
    canEditWorkspace(ws),
    currentUserId(),
    loadWorkspaceSolutions(ws),
    loadWorkspaceIssues(ws),
    loadProcessNames(ws),
  ]);
  const solution = solutions.solutions.find((s) => s.id === id);
  if (!solution) notFound();
  return (
    <Page title={solution.name} eyebrow="Improve" width="max-w-6xl" hideHeader>
      <SolutionPage
        workspaceId={ws}
        solutionId={solution.id}
        data={solutions}
        issues={issues}
        processes={processes}
        base={`/w/${slug}`}
        mode={canEdit ? "live" : "readonly"}
        viewerId={viewerId}
      />
    </Page>
  );
}
