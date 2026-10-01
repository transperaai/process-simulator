import { notFound, redirect } from "next/navigation";
import { EditorView } from "@/components/editor/editor-view";
import { canEditWorkspace, currentViewer } from "@/lib/access-data";
import { loadProcessForEditing, loadWorkspaceBlocks, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";
import { firstPrinciplesDraftChanged } from "@/lib/first-principles/data";
import { exitHref, parseEditorMode, parseHorizon } from "@/lib/editor/modes";

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
  searchParams: { mode?: string | string[]; from?: string | string[]; horizon?: string | string[] };
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
  return (
    <EditorView
      key={live.process.id}
      live={live}
      draft={draft}
      mode="live"
      extraChanges={fpChanged ? 1 : 0}
      editorMode={parseEditorMode(searchParams.mode)}
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
