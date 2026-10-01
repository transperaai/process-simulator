import Link from "next/link";
import { northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { IssuesPage } from "@/components/issues-page";
import { Page } from "@/components/shell/page";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/** The Issues screen on the demo: Northbeam's sample issues plus what a fresh run detects, in memory. */
export default function DemoIssuesPage() {
  const bundle = demoBundle();
  return (
    <Page
      title="Issues"
      eyebrow="Improve"
      description={
        <>
          Audit findings and what the simulation detects on {bundle.process.name}. Ratings follow the{" "}
          <Link href="/demo/settings/rules" className="underline">
            analysis rules
          </Link>
          . Demo mode: changes stay in this tab and are gone when you reload.
        </>
      }
    >
      <IssuesPage
        bundle={bundle}
        issues={northbeamIssues()}
        scenarios={northbeamScenarios()}
        processes={processesOf(bundle).map((p) => ({ id: p.id, name: p.name }))}
        sources={demoSources()}
        mode="demo"
      />
    </Page>
  );
}
