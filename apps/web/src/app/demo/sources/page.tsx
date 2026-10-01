import { Page } from "@/components/shell/page";
import { SourcesPage } from "@/components/sources-page";
import { demoBundle, demoCitations, demoSources } from "@/lib/sources/demo";

/** The Sources screen on the demo: Northbeam's sample sources, in memory. */
export default function DemoSourcesPage() {
  const bundle = demoBundle();
  return (
    <Page
      title="Sources"
      eyebrow="Company"
      description="What the audit recorded, and every number that cites it. Demo mode: changes stay in this tab and are gone when you reload."
    >
      <SourcesPage workspaceId={bundle.workspace.id} sources={demoSources()} citations={demoCitations(bundle)} mode="demo" processHref="/demo" />
    </Page>
  );
}
