import { WorkspaceProcessPage } from "@/components/workspace-process-page";

/** The workspace's first published process on the canvas (other processes: `/w/[slug]/p/[processId]`). */
export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const { fix } = await props.searchParams;
  return <WorkspaceProcessPage slug={slug} fix={typeof fix === "string" ? fix : null} />;
}
