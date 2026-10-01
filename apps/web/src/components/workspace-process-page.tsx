import { notFound } from "next/navigation";
import { createServicingProcess } from "@/app/w/[slug]/process-actions";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, currentViewer } from "@/lib/access-data";
import { loadWorkspaceLeverSettings } from "@/lib/levers/data";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";
import { loadProcessForEditing, loadWorkspaceIssues, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

/**
 * A process of the workspace on the canvas, at `/w/[slug]/p/[processId]` (any process, never-published ones
 * included; issue #76). The workspace root is the Overview.
 */
export async function WorkspaceProcessPage({ slug, processId }: { slug: string; processId: string }) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) notFound();
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
        />
      }
    />
  );
}
