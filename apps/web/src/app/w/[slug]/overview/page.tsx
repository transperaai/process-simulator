import { WorkspaceOverview } from "@/components/overview/workspace-overview";

/** The Overview (issue #100): where the whole company stands. */
export default async function OverviewPage(props: PageProps<"/w/[slug]/overview">) {
  const { slug } = await props.params;
  return <WorkspaceOverview slug={slug} />;
}
