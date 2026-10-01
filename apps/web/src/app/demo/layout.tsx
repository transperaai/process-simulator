import { cookies } from "next/headers";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { northbeamIssues, processesOf } from "@transpera-flow/db";
import { demoBundle } from "@/lib/sources/demo";
import { demoSuggestions } from "@/lib/suggestions/demo";

/**
 * The sidebar around the demo's pages (issue #93). The pending count is the seed's: reviews on the demo live only
 * in the tab, so it doesn't drop as they are made.
 */
export default async function DemoLayout({ children }: LayoutProps<"/demo">) {
  const pendingSuggestions = demoSuggestions().filter((s) => s.status === "pending").length;
  const counts = {
    processes: processesOf(demoBundle()).length,
    openIssues: northbeamIssues().filter((i) => i.status === "open" || i.status === "in_progress").length,
    pendingSuggestions,
  };
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <WorkspaceShell mode="demo" defaultOpen={defaultOpen} counts={counts}>
      {children}
    </WorkspaceShell>
  );
}
