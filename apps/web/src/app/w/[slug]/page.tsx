import { WorkspaceProcessPage } from "@/components/workspace-process-page";
import { parseVersion } from "@/lib/process-version";

/** The workspace's first published process on the canvas (other processes: `/w/[slug]/p/[processId]`). */
export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const { version } = await props.searchParams;
  return <WorkspaceProcessPage slug={slug} version={parseVersion(version)} />;
}
