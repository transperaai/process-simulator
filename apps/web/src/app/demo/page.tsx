import Link from "next/link";
import { notFound } from "next/navigation";
import { bundleForProcess, northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { AppHeader } from "@/components/app-header";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/**
 * The Northbeam sample from the seed fixtures, no database needed. `?fix=<issue>`
 * runs that issue's fix; `?process=<id>` opens one of its servicing processes
 * (issue #19), which simulates beside the pipeline.
 */
export default async function DemoPage(props: PageProps<"/demo">) {
  const { fix, process } = await props.searchParams;
  // Sources disagree on audit time (a conflict) and kickoff time is an assumption, so the checklist and the publish check can be tried.
  const pipeline = demoBundle();
  const bundle = typeof process === "string" ? bundleForProcess(pipeline, process) : pipeline;
  if (!bundle) notFound();
  const processes = processesOf(pipeline).map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: true, draft: false }));
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, p.id === pipeline.process.id ? "/demo" : `/demo?process=${p.id}`]));
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={`${bundle.workspace.name} · demo`} signedIn={false} />
      <p className="mt-3 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
        Demo mode: sample data from the seed fixtures, not a database. Edit the map freely: edits open a draft you can
        compare with live, publish or discard. Move levers, save scenarios and log issues too. Split a step a saved
        scenario changes (right-click “Audit &amp; proposal”, Split in two) to see it flagged for re-pointing. Everything
        stays in this tab and is gone when you reload.
      </p>
      <div className="mt-4 mb-3 flex items-baseline gap-4">
        <h1 className="text-xl font-bold">{bundle.process.name}</h1>
        <Link href="/demo/clients" className="text-fg-2 hover:underline">
          Clients
        </Link>
        <Link href="/demo/sources" className="text-fg-2 hover:underline">
          Sources
        </Link>
      </div>
      <ProcessNav processes={processes} current={bundle.process.id} hrefs={hrefs} />
      <ProcessView
        key={bundle.process.id}
        live={bundle}
        draft={null}
        mode="demo"
        scenarios={northbeamScenarios()}
        issues={northbeamIssues()}
        sources={demoSources()}
        initialFix={typeof fix === "string" ? fix : null}
      />
    </main>
  );
}
