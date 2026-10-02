import { notFound, redirect } from "next/navigation";
import { EditorView } from "@/components/editor/editor-view";
import { canEditWorkspace, currentViewer } from "@/lib/access-data";
import { loadProcessForEditing, loadWorkspaceBlocks, loadWorkspaceIssues, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";
import { firstPrinciplesDraftChanged } from "@/lib/first-principles/data";
import { exitHref, parseEditorMode, parseHorizon, parseIssueParam } from "@/lib/editor/modes";
import { issueAboutProcess, solutionIssueOf } from "@/lib/solutions/area";

/**
 * The Editor for a process of the workspace (issue #104): `/w/[slug]/p/[processId]/edit`. Full screen, outside the
 * sidebar. Someone who can't edit goes back to the map, which they can still read.
 */
export async function WorkspaceEditorPage({
  slug,
  processId,
  searchParams,
}: {
  slug: string;
  processId: string;
  searchParams: { mode?: string | string[]; from?: string | string[]; horizon?: string | string[]; issue?: string | string[] };
}) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) notFound();
  const { live, draft } = process;
  const base = `/w/${slug}/p/${processId}`;
  const canEdit = await canEditWorkspace(live.workspace.id);
  if (!canEdit) redirect(base);
  const [scenarios, blocks, sources, viewer, fpChanged] = await Promise.all([
    loadWorkspaceScenarios(live.workspace.id),
    loadWorkspaceBlocks(live.workspace.id),
    loadWorkspaceSources(live.workspace.id),
    currentViewer(),
    firstPrinciplesDraftChanged(live.process.id, live.revision.id, draft?.revision.id ?? null),
  ]);
  // Solution mode built for an issue (`?issue=`, A49): the issue's steps are outlined and its target is what the verdict checks.
  const editorMode = parseEditorMode(searchParams.mode);
  const issueId = editorMode === "solution" ? parseIssueParam(searchParams.issue) : null;
  const issueRow = issueId ? (await loadWorkspaceIssues(live.workspace.id)).find((i) => i.id === issueId) : undefined;
  return (
    <EditorView
      key={live.process.id}
      live={live}
      draft={draft}
      mode="live"
      extraChanges={fpChanged ? 1 : 0}
      editorMode={editorMode}
      issue={issueRow && issueAboutProcess(issueRow, live.process.id) ? solutionIssueOf(issueRow, live.process.id, live.steps) : null}
      scenarios={scenarios}
      blocks={blocks}
      sources={sources}
      userId={viewer?.userId ?? null}
      viewer={viewer}
      sourcesHref={`/w/${slug}/sources`}
      exitHref={exitHref(searchParams.from, base)}
      horizonMonths={parseHorizon(searchParams.horizon)}
    />
  );
}
