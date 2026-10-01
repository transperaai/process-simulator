import { notFound } from "next/navigation";
import { bundleForProcess, northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { Info } from "lucide-react";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { withDemoGroups } from "@/lib/demo/nested";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/**
 * The Northbeam sample from the seed fixtures, no database needed. `?fix=<issue>`
 * runs that issue's fix; `?process=<id>` opens one of its servicing processes
 * (issue #19), which simulates beside the pipeline. `?nested=1` draws the same
 * process with two groups of steps, to try opening and closing them (issue #102).
 */
export default async function DemoPage(props: PageProps<"/demo">) {
  const { fix, process, nested } = await props.searchParams;
  // Sources disagree on audit time (a conflict) and kickoff time is an assumption, so the checklist and the publish check can be tried.
  const pipeline = nested === "1" ? withDemoGroups(demoBundle()) : demoBundle();
  const bundle = typeof process === "string" ? bundleForProcess(pipeline, process) : pipeline;
  if (!bundle) notFound();
  const processes = processesOf(pipeline).map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: true, draft: false }));
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, p.id === pipeline.process.id ? "/demo" : `/demo?process=${p.id}`]));
  return (
    <ProcessView
      key={bundle.process.id}
      live={bundle}
      draft={null}
      mode="demo"
      scenarios={northbeamScenarios()}
      issues={northbeamIssues()}
      sources={demoSources()}
      initialFix={typeof fix === "string" ? fix : null}
      processPicker={<ProcessNav processes={processes} current={bundle.process.id} hrefs={hrefs} />}
      notice={
        <Alert role="note">
          <Info />
          <AlertDescription className="text-xs leading-relaxed">
            <p>
              Demo mode: sample data from the seed fixtures, not a database. Edit the map freely: edits open a draft you can compare with
              live, publish or discard. Move levers, save scenarios and log issues too. Split a step a saved scenario changes (right-click
              “Audit &amp; proposal”, Split in two) to see it flagged for re-pointing. Everything stays in this tab and is gone when you
              reload.
            </p>
          </AlertDescription>
        </Alert>
      }
    />
  );
}
