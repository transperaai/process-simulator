import Link from "next/link";
import { northbeamIssues, northbeamScenarios, processesOf } from "@transpera-flow/db";
import { IssuesPage } from "@/components/issues-page";
import { Page } from "@/components/shell/page";
import { parseListState } from "@/lib/issues/pages";
import { demoBundle, demoSources } from "@/lib/sources/demo";

/** The Issues list on the demo: Northbeam's sample issues, in memory. */
export default async function DemoIssuesPage(props: PageProps<"/demo/issues">) {
  const initial = parseListState(await props.searchParams);
  const bundle = demoBundle();
  return (
    <Page
      title="Issues"
      eyebrow="Improve"
      description={
        <>
          Problems you&apos;ve confirmed, linked to a whole process or to specific steps. Ratings follow the{" "}
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
        initial={initial}
        base="/demo"
        mode="demo"
      />
    </Page>
  );
}
