import Link from "next/link";
import { notFound } from "next/navigation";
import { bundleForProcess, larkspurBundle, processesOf } from "@transpera-flow/db";
import { Info } from "lucide-react";
import { ProcessNav } from "@/components/process-nav";
import { ProcessView } from "@/components/process-view";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Larkspur Creative, the second golden agency (docs/PRD.md §6.9; issue #22),
 * from the seed fixtures, no database needed: read-only, so it can be looked
 * at on any deployment, previews included. `?process=<id>` opens one of its
 * servicing processes.
 */
export default async function LarkspurDemoPage(props: PageProps<"/demo/larkspur">) {
  const { process } = await props.searchParams;
  const pipeline = larkspurBundle();
  const bundle = typeof process === "string" ? bundleForProcess(pipeline, process) : pipeline;
  if (!bundle) notFound();
  const processes = processesOf(pipeline).map((p) => ({ id: p.id, name: p.name, kind: p.kind, live: true, draft: false }));
  const hrefs = Object.fromEntries(processes.map((p) => [p.id, p.id === pipeline.process.id ? "/demo/larkspur" : `/demo/larkspur?process=${p.id}`]));
  return (
    <ProcessView
      key={bundle.process.id}
      live={bundle}
      draft={null}
      mode="readonly"
      processPicker={<ProcessNav processes={processes} current={bundle.process.id} hrefs={hrefs} />}
      notice={
        <Alert role="note">
          <Info />
          <AlertDescription>
            Demo mode, read-only: Larkspur Creative, the messier of the two sample agencies the engine is tested against. Its designers are
            overloaded, its only copywriter works overtime, and late or missed client work wears its roster&apos;s health down until clients
            leave. For an agency you can edit, see <Link href="/demo" className="underline">Northbeam</Link>.
          </AlertDescription>
        </Alert>
      }
    />
  );
}
