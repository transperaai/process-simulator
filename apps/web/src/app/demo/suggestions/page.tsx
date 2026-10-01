import { northbeamSources } from "@transpera-flow/db";
import { Page } from "@/components/shell/page";
import { DemoSuggestions } from "@/components/suggestions-review";

/** The Suggestions screen on the demo: sample suggestions for Northbeam, reviewed in memory. */
export default function DemoSuggestionsPage() {
  const sources = Object.fromEntries(northbeamSources().map((s) => [s.id, s.title]));
  return (
    <Page
      title="Suggestions"
      eyebrow="Improve"
      description="Demo mode: changes Claude might suggest after Northbeam's audit interviews. Accept or reject them one by one or in bulk; accepted values are marked estimated and keep their quotes. Everything stays in this tab and is gone when you reload."
    >
      <DemoSuggestions sources={sources} sourcesHref="/demo/sources" />
    </Page>
  );
}
