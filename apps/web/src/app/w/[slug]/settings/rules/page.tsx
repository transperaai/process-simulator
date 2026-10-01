import { notFound } from "next/navigation";
import { AnalysisRulesSettings } from "@/components/rules/analysis-rules-settings";
import { canEditWorkspace } from "@/lib/access-data";
import { loadLiveFirstPrinciples } from "@/lib/first-principles/data";
import { loadLiveProcess, loadProcessNames, loadWorkspaceHead } from "@/lib/data";
import { loadWorkspaceAnalysisRules } from "@/lib/rules/data";

/**
 * Settings -> Analysis rules (issue #109): every rule on or off, its cut-offs, overrides, the escalators and the
 * money settings, stored per workspace. Everyone in the workspace sees them; owners and editors change them.
 */
export default async function AnalysisRulesPage(props: PageProps<"/w/[slug]/settings/rules">) {
  const { slug } = await props.params;
  const head = await loadWorkspaceHead(slug);
  if (!head) notFound();
  const [canEdit, rules, bundle, processes] = await Promise.all([
    canEditWorkspace(head.id),
    loadWorkspaceAnalysisRules(head.id),
    loadLiveProcess(slug),
    loadProcessNames(head.id),
  ]);
  const firstPrinciples = bundle ? await loadLiveFirstPrinciples(bundle.process.id, bundle.revision.id) : null;
  return <AnalysisRulesSettings mode={canEdit ? "live" : "readonly"} workspaceId={head.id} initial={rules} bundle={bundle} firstPrinciples={firstPrinciples} processes={processes} />;
}
