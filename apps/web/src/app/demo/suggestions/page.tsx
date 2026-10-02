import { northbeamIssues, northbeamSources } from "@transpera-flow/db";
import { demoBundle } from "@/lib/sources/demo";
import { DemoProposals } from "@/components/proposals-review";
import { Page } from "@/components/shell/page";
import { DemoSuggestions } from "@/components/suggestions-review";
import type { ProposalLookups } from "@/lib/suggestions/proposals";

/** The Suggestions screen on the demo: sample proposals and company changes for Northbeam, reviewed in memory. */
export default function DemoSuggestionsPage() {
  const sources = Object.fromEntries(northbeamSources().map((s) => [s.id, s.title]));
  const bundle = demoBundle();
  const lookups: ProposalLookups = {
    processes: { [bundle.process.id]: bundle.process.name },
    steps: Object.fromEntries(bundle.steps.map((s) => [s.id, s.name])),
    issues: Object.fromEntries(northbeamIssues().map((i) => [i.id, { number: i.number, title: i.title, processId: i.process_id }])),
  };
  const sample = northbeamIssues().length;
  return (
    <Page
      title="Suggestions"
      eyebrow="Improve"
      description="Demo mode: everything AI proposes waits here, and nothing reaches the map, issues, solutions or settings until you act on it. Accept or reject proposals one by one, or review the changes to the company model in bulk. Everything stays in this tab and is gone when you reload."
    >
      <DemoProposals lookups={lookups} base="/demo" linkableUpTo={sample}>
        <DemoSuggestions sources={sources} sourcesHref="/demo/sources" />
      </DemoProposals>
    </Page>
  );
}
