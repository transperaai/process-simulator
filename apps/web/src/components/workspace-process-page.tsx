import { notFound } from "next/navigation";
import { createServicingProcess } from "@/app/w/[slug]/process-actions";
import { isUnpublished } from "@transpera-flow/db";
import { ProcessNav } from "@/components/process-nav";
import { ProcessPage } from "@/components/process-page";
import { canEditWorkspace } from "@/lib/access-data";
import { loadWorkspaceLeverSettings } from "@/lib/levers/data";
import { processRatings } from "@/lib/processes/rows";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";
import { loadProcessForEditing, loadProcessVersion, loadWorkspaceIssues, loadWorkspaceScenarios, loadWorkspaceSources } from "@/lib/data";

/**
 * A process of the workspace on the canvas, at `/w/[slug]/p/[processId]` (any process, never-published ones
 * included; issue #76). The workspace root is the Overview.
 */
export async function WorkspaceProcessPage({ slug, processId, version }: { slug: string; processId: string; version?: number | null }) {
  const process = await loadProcessForEditing(slug, processId);
  if (!process) notFound();
  const { live, draft, processes } = process;
  // `?version=N` shows an earlier version, read only; a number that isn't an earlier version shows live.
  const earlier = version ? await loadProcessVersion(live, version) : null;
  const [canEdit, scenarios, issues, sources, rules, levers] = await Promise.all([
    canEditWorkspace(live.workspace.id),
    loadWorkspaceScenarios(live.workspace.id),
    loadWorkspaceIssues(live.workspace.id),
    loadWorkspaceSources(live.workspace.id),
    loadWorkspaceAnalysisRules(live.workspace.id),
    loadWorkspaceLeverSettings(live.workspace.id),
  ]);
  const base = `/w/${slug}`;
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, `${base}/p/${p.id}`]));
  const ratings = processRatings(processes, issues, [...live.steps, ...(live.otherProcesses ?? []).flatMap((p) => p.steps)]);
  return (
    <ProcessPage
      key={live.process.id}
      // A process never published has only its draft to show.
      bundle={earlier ?? (isUnpublished(live) && draft ? draft : live)}
      viewingVersion={earlier ? earlier.revision.number : null}
      liveVersion={isUnpublished(live) ? 0 : live.revision.number}
      // An earlier version is read only, so nothing on it can be logged or edited.
      mode={canEdit && !earlier ? "live" : "readonly"}
      scenarios={scenarios}
      issues={issues}
      sources={sources}
      liveRevisions={isUnpublished(live) ? {} : { [live.process.id]: live.revision.id }}
      analysisRules={rules.settings}
      hiddenLevers={levers.hidden}
      registerHref={`${base}/issues`}
      settingsHref={`${base}/settings`}
      rating={ratings[live.process.id] ?? null}
      editHref={canEdit ? `${base}/p/${live.process.id}/edit` : undefined}
      historyHref={`${base}/p/${live.process.id}/history`}
      inside={processes.filter((p) => p.parentId === live.process.id).map((p) => ({ id: p.id, name: p.name, href: hrefs[p.id]! }))}
      processPicker={
        <ProcessNav
          processes={processes}
          current={live.process.id}
          hrefs={hrefs}
          create={canEdit ? createServicingProcess.bind(null, live.workspace.id, slug) : undefined}
          ratings={ratings}
          processesHref={`${base}/processes`}
          companyMapHref={base}
        />
      }
    />
  );
}
