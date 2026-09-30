import { ShellHeader } from "@/components/shell/shell-header";
import { SourcesPage } from "@/components/sources-page";
import { demoBundle, demoCitations, demoSources } from "@/lib/sources/demo";

/** The Sources screen on the demo: Northbeam's sample sources, in memory. */
export default function DemoSourcesPage() {
  const bundle = demoBundle();
  return (
    <div>
      <ShellHeader title="Sources" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Sources</h1>
        <p className="mb-4 text-fg-2">
          What the audit recorded, and every number that cites it. Demo mode: changes stay in this tab and are gone when you
          reload.
        </p>
        <SourcesPage workspaceId={bundle.workspace.id} sources={demoSources()} citations={demoCitations(bundle)} mode="demo" processHref="/demo" />
      </div>
    </div>
  );
}
