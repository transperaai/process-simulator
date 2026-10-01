import { WorkspaceOverview } from "@/components/overview/workspace-overview";

/** A workspace opens on its Overview (issue #100); the first process's map is under Processes, at `/w/[slug]/p/[processId]`. */
export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  return <WorkspaceOverview slug={slug} />;
}
