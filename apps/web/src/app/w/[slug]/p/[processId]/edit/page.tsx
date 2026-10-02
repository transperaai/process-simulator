import { notFound } from "next/navigation";
import { WorkspaceEditorPage } from "@/components/editor/workspace-editor-page";
import { isId } from "@/lib/editor/validate";

// Saving a solution simulates it on the server (the Server Action runs for as long as this page allows).
export const maxDuration = 60;

/** The Editor: a process's draft on its own screen (issue #104). */
export default async function EditPage(props: PageProps<"/w/[slug]/p/[processId]/edit">) {
  const { slug, processId } = await props.params;
  if (!isId(processId)) notFound();
  return <WorkspaceEditorPage slug={slug} processId={processId} searchParams={await props.searchParams} />;
}
