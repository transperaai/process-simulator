import { notFound } from "next/navigation";
import { buildSolutionHref, solutionEditorHref } from "@/lib/solutions/links";
import { bundleForProcess, northbeamIssues, processesOf } from "@transpera-flow/db";
import { IssuePage } from "@/components/issues/issue-page";
import { Page } from "@/components/shell/page";
import { DemoIssueIdeas } from "@/components/idea-card";
import { findIssue } from "@/lib/issues/pages";
import type { ProposalLookups } from "@/lib/suggestions/proposals";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/** One issue on the demo: Northbeam's sample issues, in memory (a resolve or an edit stays in this tab). */
export default async function DemoIssuePage(props: PageProps<"/demo/issues/[number]">) {
  const { number } = await props.params;
  const pipeline = demoBundle();
  const issues = northbeamIssues();
  const issue = findIssue(issues, number);
  if (!issue) notFound();
  const processId = issue.links.find((l) => l.process_id)?.process_id ?? issue.process_id;
  const bundle = (processId ? bundleForProcess(pipeline, processId) : null) ?? pipeline;
  const lookups: ProposalLookups = {
    processes: { [bundle.process.id]: bundle.process.name },
    steps: Object.fromEntries(bundle.steps.map((s) => [s.id, s.name])),
    issues: Object.fromEntries(issues.map((i) => [i.id, { number: i.number, title: i.title, processId: i.process_id }])),
  };
  return (
    <Page title={issue.number ? `Issue #${issue.number}` : "Issue"} eyebrow="Improve" width="max-w-6xl" hideHeader>
      <IssuePage
        issue={issue}
        issues={issues}
        bundle={bundle}
        processes={processesOf(pipeline).map((p) => ({ id: p.id, name: p.name }))}
        sources={demoSources()}
        events={[]}
        mode="demo"
        base="/demo"
        ideas={<DemoIssueIdeas key="ideas" issueId={issue.id} base="/demo" from={`/demo/issues/${issue.number}`} lookups={lookups} linkableUpTo={issues.length} />}
        buildHref={buildSolutionHref("/demo", issue, `${"/demo"}/issues/${issue.number}`) ?? solutionEditorHref("/demo", bundle.process.id, { issueId: issue.id })}
      />
    </Page>
  );
}
