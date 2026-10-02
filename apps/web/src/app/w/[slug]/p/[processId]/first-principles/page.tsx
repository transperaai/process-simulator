import { notFound } from "next/navigation";
import { WorkspaceFirstPrinciplesPage } from "@/components/workspace-first-principles-page";
import { isId } from "@/lib/editor/validate";

/** A process's first-principles flow (issue #119, A54): seven steps, saved per process version, always into its draft. */
/** AI analysis runs here after a response (A46): allow it time. */
export const maxDuration = 120;

export default async function FirstPrinciplesPage(props: PageProps<"/w/[slug]/p/[processId]/first-principles">) {
  const { slug, processId } = await props.params;
  if (!isId(processId)) notFound();
  return <WorkspaceFirstPrinciplesPage slug={slug} processId={processId} />;
}
