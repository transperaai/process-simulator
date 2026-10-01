import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { IssuesPage } from "@/components/issues-page";
import { canEditWorkspace } from "@/lib/access-data";
import { loadLiveProcess, loadProcessNames, loadWorkspaceIssues, loadWorkspaceScenarios } from "@/lib/data";

/** The issues register (docs/PRD.md §8 screen 9): every tracked issue, and what the live process's latest run detects. */
export default async function WorkspaceIssuesPage(props: PageProps<"/w/[slug]/issues">) {
  const { slug } = await props.params;
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  const ws = bundle.workspace.id;
  const [canEdit, issues, scenarios, processes] = await Promise.all([
    canEditWorkspace(ws),
    loadWorkspaceIssues(ws),
    loadWorkspaceScenarios(ws),
    loadProcessNames(ws),
  ]);
  return (
    <div>
      <ShellHeader title="Issues" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Issues register</h1>
        <p className="mb-4 text-fg-2">
          Audit findings and what the simulation detects on {bundle.process.name}, each linked to its fix. Changes save as
          you go.
        </p>
        <IssuesPage
          bundle={bundle}
          issues={issues}
          scenarios={scenarios}
          processes={processes}
          mode={canEdit ? "live" : "readonly"}
        />
      </div>
    </div>
  );
}
