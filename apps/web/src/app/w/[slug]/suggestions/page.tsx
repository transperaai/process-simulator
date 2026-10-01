import Link from "next/link";
import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { ChangeLog, LiveSuggestions } from "@/components/suggestions-review";
import { loadSuggestionsPage } from "@/lib/company-data";

/** The Suggestions screen (docs/PRD.md §8 screen 8, §7.1c; issue #25). */
export default async function SuggestionsPage(props: PageProps<"/w/[slug]/suggestions">) {
  const { slug } = await props.params;
  const data = await loadSuggestionsPage(slug);
  if (!data) notFound();
  return (
    <Page
      title="Suggestions"
      eyebrow="Improve"
      description={
        <>
          Changes Claude suggested to people, clients, services, demand and company settings. Nothing changes until someone accepts; accepted
          values are marked estimated and keep the quotes they cite. Changes you make in{" "}
          <Link href={`/w/${slug}/settings`} className="underline underline-offset-2">
            settings
          </Link>{" "}
          apply straight away.
          {!data.canEdit && " You can view suggestions; editors and owners review them."}
        </>
      }
    >
      <LiveSuggestions
        workspaceId={data.workspace.id}
        initial={data.suggestions}
        model={data.model}
        sources={data.sources}
        canEdit={data.canEdit}
        sourcesHref={`/w/${slug}/sources`}
      />
      {data.changes && <ChangeLog entries={data.changes} model={data.model} people={data.people} />}
    </Page>
  );
}
