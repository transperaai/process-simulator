import { northbeamIssues, partOf, processesOf } from "@transpera-flow/db";
import { Overview } from "@/components/overview/overview";
import { demoAiView } from "@/lib/ai/demo";
import { DEMO_LIVE_VERSION } from "@/lib/history/demo";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/** The Overview of the Northbeam demo (issue #100): the landing page of `/demo`, also at `/demo/overview`. No database. */
export function DemoOverview() {
  const live = demoBundle();
  const parts = [partOf(live), ...(live.otherProcesses ?? [])];
  const hrefs = Object.fromEntries(processesOf(live).map((p) => [p.id, `/demo/p/${p.id}`]));
  return (
    <Overview
      workspaceName={live.workspace.name}
      live={live}
      parts={parts}
      issues={northbeamIssues()}
      sources={demoSources()}
      mode="demo"
      hrefs={hrefs}
      processesHref="/demo/processes"
      issuesHref="/demo/issues"
      rulesHref="/demo/settings/rules"
      // Written in advance: the demo never calls an AI.
      ai={{ view: demoAiView(live.process.id), configured: true, hasFirstPrinciples: true, versionNumber: DEMO_LIVE_VERSION }}
    />
  );
}
