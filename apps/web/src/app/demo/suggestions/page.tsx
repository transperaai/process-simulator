import Link from "next/link";
import { northbeamSources } from "@transpera-flow/db";
import { ShellHeader } from "@/components/shell/shell-header";
import { DemoSuggestions } from "@/components/suggestions-review";

/** The Suggestions screen on the demo: sample suggestions for Northbeam, reviewed in memory. */
export default function DemoSuggestionsPage() {
  const sources = Object.fromEntries(northbeamSources().map((s) => [s.id, s.title]));
  return (
    <div>
      <ShellHeader title="Suggestions" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Suggestions</h1>
        <p className="mb-4 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
          Demo mode: changes Claude might suggest after Northbeam&apos;s audit interviews. Accept or reject them one by one or in bulk; accepted
          values are marked estimated and keep their quotes. Then open{" "}
          <Link href="/demo/runs" className="underline">
            Saved runs
          </Link>{" "}
          to see the run saved before them flag what changed. Everything stays in this tab and is gone when you reload.
        </p>
        <DemoSuggestions sources={sources} sourcesHref="/demo/sources" />
      </div>
    </div>
  );
}
