import { cookies } from "next/headers";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { DemoSourceLinkingScope } from "@/components/sources/linking-scope";
import { NORTHBEAM_WORKSPACE_ID, northbeamIssues, processesOf, unlinkedSources } from "@transpera-flow/db";
import { demoBundle, demoPageSources, demoSourceLinks } from "@/lib/sources/demo";
import { demoProposals, demoSuggestions } from "@/lib/suggestions/demo";

/**
 * The sidebar around the demo's pages (issue #93). The pending count is the seed's: reviews on the demo live only
 * in the tab, so it doesn't drop as they are made.
 */
export default async function DemoLayout({ children }: LayoutProps<"/demo">) {
  const pendingSuggestions = [...demoSuggestions(), ...demoProposals()].filter((s) => s.status === "pending").length;
  const counts = {
    processes: processesOf(demoBundle()).length,
    openIssues: northbeamIssues().filter((i) => i.status === "open" || i.status === "testing").length,
    pendingSuggestions,
    // The sample's, like the pending count: sources linked in this tab don't lower it.
    unlinkedSources: unlinkedSources(demoPageSources(), demoSourceLinks()).length,
  };
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <WorkspaceShell mode="demo" defaultOpen={defaultOpen} counts={counts}>
      {/* "+ Link" on the sample's steps, insights and issues: its sources and links live in the tab. */}
      <DemoSourceLinkingScope workspaceId={NORTHBEAM_WORKSPACE_ID}>{children}</DemoSourceLinkingScope>
    </WorkspaceShell>
  );
}
