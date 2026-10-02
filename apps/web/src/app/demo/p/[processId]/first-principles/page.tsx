import { notFound } from "next/navigation";
import { bundleForProcess } from "@transpera-flow/db";
import { DemoFirstPrinciplesFlow } from "@/components/first-principles/flow-clients";
import { demoAiView } from "@/lib/ai/demo";
import { DEMO_LIVE_VERSION } from "@/lib/history/demo";
import { demoBundle } from "@/lib/sources/demo";

/**
 * The first-principles flow for one of the Northbeam sample's processes (issue #119): no database, answers kept in
 * this tab. The pipeline starts with a worked example; the others start empty.
 */
export default async function DemoFirstPrinciplesPage(props: PageProps<"/demo/p/[processId]/first-principles">) {
  const { processId } = await props.params;
  const bundle = bundleForProcess(demoBundle(), processId);
  if (!bundle) notFound();
  return (
    <DemoFirstPrinciplesFlow
      key={bundle.process.id}
      processId={bundle.process.id}
      bundle={bundle}
      processHref={`/demo/p/${bundle.process.id}`}
      processesHref="/demo/processes"
      peopleHref="/demo/people"
      // Written in advance: the demo never calls an AI.
      ai={{ mode: "demo", data: { view: demoAiView(bundle.process.id), configured: true, hasFirstPrinciples: true, versionNumber: DEMO_LIVE_VERSION }, canRun: true }}
    />
  );
}
