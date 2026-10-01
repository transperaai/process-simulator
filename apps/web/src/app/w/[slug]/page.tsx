import { WorkspaceProcessPage } from "@/components/workspace-process-page";

/** The workspace's first published process on the canvas (other processes: `/w/[slug]/p/[processId]`). */
export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  return <WorkspaceProcessPage slug={slug} />;
}
