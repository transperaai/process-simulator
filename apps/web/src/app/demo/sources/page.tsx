import { Page } from "@/components/shell/page";
import { SourcesPage } from "@/components/sources-page";
import { demoBundle, demoCitations, demoLinkTargets, demoPageSources, demoSourceLinks } from "@/lib/sources/demo";

/** The Sources screen on the demo: Northbeam's sample sources and what they link to, in memory. */
export default function DemoSourcesPage() {
  const bundle = demoBundle();
  return (
    <Page
      title="Sources"
      eyebrow="Company"
      description="Every source must be linked to a process, a step, an insight, an issue or a solution. Demo mode: changes stay in this tab and are gone when you reload."
    >
      <SourcesPage
        workspaceId={bundle.workspace.id}
        sources={demoPageSources()}
        citations={demoCitations(bundle)}
        links={demoSourceLinks()}
        targets={demoLinkTargets(bundle)}
        mode="demo"
        processBase="/demo/p"
      />
    </Page>
  );
}
