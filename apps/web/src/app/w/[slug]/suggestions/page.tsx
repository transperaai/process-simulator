import Link from "next/link";
import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { ChangeLog, LiveSuggestions } from "@/components/suggestions-review";
import { loadSuggestionsPage } from "@/lib/company-data";

/** The Suggestions screen (docs/PRD.md §8 screen 8, §7.1c; issue #25). */
export default async function SuggestionsPage(props: PageProps<"/w/[slug]/suggestions">) {
  const { slug } = await props.params;
  const data = await loadSuggestionsPage(slug);
  if (!data) notFound();
  return (
    <div>
      <ShellHeader title="Suggestions" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Suggestions</h1>
        <p className="mb-4 text-fg-2">
          Changes Claude suggested to people, clients, services, demand and company settings. Nothing changes until someone accepts; accepted
          values are marked estimated and keep the quotes they cite. Changes you make in{" "}
          <Link href={`/w/${slug}/settings`} className="underline">
            settings
          </Link>{" "}
          apply straight away.
          {!data.canEdit && " You can view suggestions; editors and owners review them."}
        </p>
        <LiveSuggestions
          workspaceId={data.workspace.id}
          initial={data.suggestions}
          model={data.model}
          sources={data.sources}
          canEdit={data.canEdit}
          sourcesHref={`/w/${slug}/sources`}
        />
        {data.changes && <ChangeLog entries={data.changes} model={data.model} people={data.people} />}
      </div>
    </div>
  );
}
