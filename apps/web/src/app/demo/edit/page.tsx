import { notFound } from "next/navigation";
import { bundleForProcess } from "@transpera-flow/db";
import { EditorView } from "@/components/editor/editor-view";
import { withDemoGroups } from "@/lib/demo/nested";
import { exitHref, parseEditorMode } from "@/lib/editor/modes";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/**
 * The Editor on the Northbeam sample, no database needed (issue #104). `?process=<id>` opens a servicing process and
 * `?nested=1` the sample with two groups, as the map does. Edits live in this tab only.
 */
export default async function DemoEditPage(props: PageProps<"/demo/edit">) {
  const search = await props.searchParams;
  const { process, nested } = search;
  const pipeline = nested === "1" ? withDemoGroups(demoBundle()) : demoBundle();
  const bundle = typeof process === "string" ? bundleForProcess(pipeline, process) : pipeline;
  if (!bundle) notFound();
  const back = `/demo${typeof process === "string" ? `?process=${process}` : nested === "1" ? "?nested=1" : ""}`;
  return (
    <EditorView
      key={bundle.process.id}
      live={bundle}
      draft={null}
      mode="demo"
      editorMode={parseEditorMode(search.mode)}
      sources={demoSources()}
      sourcesHref="/demo/sources"
      exitHref={exitHref(search.from, back)}
    />
  );
}
