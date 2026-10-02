import { NORTHBEAM_WORKSPACE_ID, northbeamIssues, processesOf } from "@transpera-flow/db";
import { SolutionPage } from "@/components/solutions/solution-page";
import { Page } from "@/components/shell/page";
import { demoBundle } from "@/lib/sources/demo";

/** One solution on the demo: it is read from this tab's memory, so a reload (or a link opened elsewhere) says it is gone. */
export default async function DemoSolutionPage(props: PageProps<"/demo/solutions/[id]">) {
  const { id } = await props.params;
  return (
    <Page title="Solution" eyebrow="Improve" width="max-w-6xl" hideHeader>
      <SolutionPage
        workspaceId={NORTHBEAM_WORKSPACE_ID}
        solutionId={id}
        issues={northbeamIssues()}
        processes={processesOf(demoBundle()).map((p) => ({ id: p.id, name: p.name }))}
        base="/demo"
        mode="demo"
      />
    </Page>
  );
}
