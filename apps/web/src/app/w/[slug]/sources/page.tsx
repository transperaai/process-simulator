import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
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
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 text-fg-2">
        <Link href={`/w/${slug}`} className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Sources</h1>
      <p className="mb-4 text-fg-2">
        What the audit recorded, and every number that cites it. Cite a source for a step&apos;s value from the step&apos;s
        inspector; sources that disagree turn the value into a range and log a perception gap.
      </p>
      <SourcesPage
        workspaceId={data.workspace.id}
        sources={data.sources}
        citations={data.citations}
        mode={canEdit ? "live" : "readonly"}
        processHref={`/w/${slug}`}
      />
    </main>
  );
}
