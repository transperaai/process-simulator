import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { SourcesPage } from "@/components/sources-page";
import { canEditWorkspace } from "@/lib/access-data";
import { loadSourcesPage } from "@/lib/data";

/** The Sources screen (docs/PRD.md §8 screen 7): the audit's transcripts and notes, and every value citing each one. */
export default async function WorkspaceSourcesPage(props: PageProps<"/w/[slug]/sources">) {
  const { slug } = await props.params;
  const data = await loadSourcesPage(slug);
  if (!data) notFound();
  const canEdit = await canEditWorkspace(data.workspace.id);
  return (
    <Page
      title="Sources"
      eyebrow="Company"
      description="What the audit recorded, and every number that cites it. Cite a source for a step's value from the step's inspector; sources that disagree turn the value into a range and log a perception gap."
    >
      <SourcesPage
        workspaceId={data.workspace.id}
        sources={data.sources}
        citations={data.citations}
        mode={canEdit ? "live" : "readonly"}
        processBase={`/w/${slug}/p`}
      />
    </Page>
  );
}
