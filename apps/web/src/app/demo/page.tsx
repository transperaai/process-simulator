import { notFound } from "next/navigation";
import { bundleForProcess, northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { Info } from "lucide-react";
import { ProcessNav } from "@/components/process-nav";
import { ProcessPage } from "@/components/process-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { withDemoGroups } from "@/lib/demo/nested";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/**
 * The Northbeam sample from the seed fixtures, no database needed. `?process=<id>`
 * opens one of its servicing processes (issue #19), which simulates beside the pipeline.
 * `?nested=1` draws the same process with two groups of steps, to try opening and
 * closing them (issue #102).
 */
export default async function DemoPage(props: PageProps<"/demo">) {
  const { process, nested } = await props.searchParams;
  // Sources disagree on audit time (a conflict) and kickoff time is an assumption, so the checklist and the publish check can be tried.
  const pipeline = nested === "1" ? withDemoGroups(demoBundle()) : demoBundle();
  const bundle = typeof process === "string" ? bundleForProcess(pipeline, process) : pipeline;
  if (!bundle) notFound();
  const processes = processesOf(pipeline).map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: true, draft: false, parentId: p.parent_process_id }));
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, p.id === pipeline.process.id ? "/demo" : `/demo?process=${p.id}`]));
  const query = typeof process === "string" ? `?process=${process}` : nested === "1" ? "?nested=1" : "";
  return (
    <ProcessPage
      key={bundle.process.id}
      bundle={bundle}
      liveVersion={bundle.revision.number}
      mode="demo"
      scenarios={northbeamScenarios()}
      issues={northbeamIssues()}
      sources={demoSources()}
      editHref={`/demo/edit${query}`}
      historyHref={`/demo/history${query}`}
      inside={processes.filter((p) => p.parentId === bundle.process.id).map((p) => ({ id: p.id, name: p.name, href: hrefs[p.id]! }))}
      processPicker={<ProcessNav processes={processes} current={bundle.process.id} hrefs={hrefs} />}
      notice={
        <Alert role="note">
          <Info />
          <AlertDescription className="text-xs leading-relaxed">
            <p>
              Demo mode: sample data from the seed fixtures, not a database. This page is for reading: press Open in Editor to open the
              Editor, where edits go into a draft you can simulate against live, publish or discard. Move levers, save scenarios and log
              issues here too. Everything stays in this tab and is gone when you reload.
            </p>
          </AlertDescription>
        </Alert>
      }
    />
  );
}
