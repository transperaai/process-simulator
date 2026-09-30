import { cookies } from "next/headers";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { demoSuggestions } from "@/lib/suggestions/demo";

/**
 * The sidebar around the demo's pages (issue #93). The pending count is the seed's: reviews on the demo live only
 * in the tab, so it doesn't drop as they are made.
 */
export default async function DemoLayout({ children }: LayoutProps<"/demo">) {
  const pendingSuggestions = demoSuggestions().filter((s) => s.status === "pending").length;
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <WorkspaceShell mode="demo" defaultOpen={defaultOpen} pendingSuggestions={pendingSuggestions}>
      {children}
    </WorkspaceShell>
  );
}
