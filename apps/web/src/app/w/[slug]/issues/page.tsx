import Link from "next/link";
import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { IssuesPage } from "@/components/issues-page";
import { loadLiveFirstPrinciples } from "@/lib/first-principles/data";
import { canEditWorkspace } from "@/lib/access-data";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";
import { loadLiveProcess, loadProcessNames, loadWorkspaceIssues, loadWorkspaceScenarios } from "@/lib/data";

/** The issues register (docs/PRD.md §8 screen 9): every tracked issue, and what the live process's latest run detects. */
export default async function WorkspaceIssuesPage(props: PageProps<"/w/[slug]/issues">) {
  const { slug } = await props.params;
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  const ws = bundle.workspace.id;
  const [canEdit, issues, scenarios, processes, rules, firstPrinciples] = await Promise.all([
    canEditWorkspace(ws),
    loadWorkspaceIssues(ws),
    loadWorkspaceScenarios(ws),
    loadProcessNames(ws),
    loadWorkspaceAnalysisRules(ws),
    loadLiveFirstPrinciples(bundle.process.id, bundle.revision.id),
  ]);
  return (
    <Page
      title="Issues"
      eyebrow="Improve"
      description={
        <>
          Audit findings and what the simulation detects on {bundle.process.name}, each linked to its fix. Changes save as you go. Ratings follow your{" "}
          <Link href={`/w/${slug}/settings/rules`} className="underline">
            analysis rules
          </Link>
          .
        </>
      }
    >
      <IssuesPage
        bundle={bundle}
        issues={issues}
        scenarios={scenarios}
        processes={processes}
        analysisRules={rules.settings}
        firstPrinciples={firstPrinciples}
        mode={canEdit ? "live" : "readonly"}
      />
    </Page>
  );
}
