import type { ReactNode } from "react";
import type { SourceLinkRow, SourceRow } from "@transpera-flow/db";
import { SourceLinkingProvider } from "@/components/sources/linking";
import { loadSourceLinking } from "@/lib/data";
import { demoLinkTargets, demoPageSources, demoSourceLinks } from "@/lib/sources/demo";

/**
 * Gives the screen inside it "+ Link" (issue #118): loads the workspace's source links and link targets and wraps the page in
 * the provider the Sources blocks read. A page passes the sources it already loaded. If the links can't be read, the page
 * shows as it did before rather than failing.
 */
export async function SourceLinkingScope({
  workspaceId,
  sources,
  canEdit,
  issueSources,
  children,
}: {
  workspaceId: string;
  sources: SourceRow[];
  canEdit: boolean;
  /** On an issue's page: the sources the issue lists (`issue_sources`), so one without a link still shows (and can be taken off). */
  issueSources?: { issueId: string; sourceIds: readonly string[] };
  children: ReactNode;
}) {
  let loaded: Awaited<ReturnType<typeof loadSourceLinking>> | null = null;
  try {
    loaded = await loadSourceLinking(workspaceId);
  } catch (err) {
    console.error("Couldn't load the source links; showing the page without them.", err instanceof Error ? err.message : err);
  }
  if (!loaded) return <>{children}</>;
  const links = issueSources ? withIssueSources(loaded.links, workspaceId, issueSources) : loaded.links;
  return (
    <SourceLinkingProvider workspaceId={workspaceId} mode={canEdit ? "live" : "readonly"} sources={sources} links={links} targets={loaded.targets}>
      {children}
    </SourceLinkingProvider>
  );
}

/** The same on the demo: Northbeam's sample sources and links, changed in the tab only. */
export function DemoSourceLinkingScope({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  return (
    <SourceLinkingProvider workspaceId={workspaceId} mode="demo" sources={demoPageSources()} links={demoSourceLinks()} targets={demoLinkTargets()}>
      {children}
    </SourceLinkingProvider>
  );
}

/**
 * The links an issue page shows: the issue's links, and one for each source on its own list that has none (the page shows the
 * union, as `loadIssue` does). Such a link is not a row: its id says so (`issue-source:<issue>:<source>`), and unlinking it takes
 * the source off the issue's list (see `unlinkSource`).
 */
export function withIssueSources(links: SourceLinkRow[], workspaceId: string, { issueId, sourceIds }: { issueId: string; sourceIds: readonly string[] }): SourceLinkRow[] {
  const have = new Set(links.filter((l) => l.kind === "issue" && l.issue_id === issueId).map((l) => l.source_id));
  const extra = sourceIds
    .filter((id) => !have.has(id))
    .map(
      (source_id): SourceLinkRow => ({
        id: `issue-source:${issueId}:${source_id}`,
        workspace_id: workspaceId,
        source_id,
        kind: "issue",
        process_id: null,
        step_id: null,
        insight_key: null,
        issue_id: issueId,
        solution_id: null,
        created_at: "",
        created_by: null,
      }),
    );
  return extra.length ? [...links, ...extra] : links;
}
