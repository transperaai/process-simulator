import { notFound } from "next/navigation";
import { bundleForProcess, northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { Info } from "lucide-react";
import { ProcessNav } from "@/components/process-nav";
import { ProcessPage } from "@/components/process-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { processRatings } from "@/lib/processes/rows";
import { withDemoGroups } from "@/lib/demo/nested";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/**
 * One of the Northbeam sample's processes on the map, from the seed fixtures, no database needed (the Overview at
 * `/demo` links here, as does Processes). A servicing process (issue #19) simulates beside the pipeline.
 * `?nested=1` draws the pipeline with two groups of steps, to try opening and closing them (issue #102).
 */
export default async function DemoProcessPage(props: PageProps<"/demo/p/[processId]">) {
  const { processId } = await props.params;
  const { nested } = await props.searchParams;
  // Sources disagree on audit time (a conflict) and kickoff time is an assumption, so the checklist and the publish check can be tried.
  const pipeline = nested === "1" ? withDemoGroups(demoBundle()) : demoBundle();
  const bundle = bundleForProcess(pipeline, processId);
  if (!bundle) notFound();
  const processes = processesOf(pipeline).map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: true, draft: false, parentId: p.parent_process_id }));
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, `/demo/p/${p.id}`]));
  const ratings = processRatings(processes, northbeamIssues(), [...pipeline.steps, ...(pipeline.otherProcesses ?? []).flatMap((p) => p.steps)]);
  return (
    <ProcessPage
      key={bundle.process.id}
      bundle={bundle}
      liveVersion={bundle.revision.number}
      mode="demo"
      scenarios={northbeamScenarios()}
      issues={northbeamIssues()}
      sources={demoSources()}
      rating={ratings[bundle.process.id] ?? null}
      editHref={`/demo/edit?process=${bundle.process.id}${nested === "1" ? "&nested=1" : ""}`}
      historyHref={`/demo/p/${bundle.process.id}/history`}
      inside={processes.filter((p) => p.parentId === bundle.process.id).map((p) => ({ id: p.id, name: p.name, href: hrefs[p.id]! }))}
      processPicker={<ProcessNav processes={processes} current={bundle.process.id} hrefs={hrefs} ratings={ratings} processesHref="/demo/processes" companyMapHref="/demo" />}
      notice={
        <Alert role="note">
          <Info />
          <AlertDescription className="text-xs leading-relaxed">
            <p>
              Demo mode: sample data from the seed fixtures, not a database. This page is for reading: press Open in Editor to change the
              process in a draft you can simulate against live, publish or discard. Move the levers and log issues here to try them out.
              Everything stays in this tab and is gone when you reload.
            </p>
          </AlertDescription>
        </Alert>
      }
    />
  );
}
