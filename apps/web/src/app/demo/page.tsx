import { northbeamBundle, northbeamStepIds } from "@transpera-flow/db";
import { AppHeader } from "@/components/app-header";
import { ProcessView } from "@/components/process-view";

/** The Northbeam sample from the seed fixtures, no database needed. */
export default function DemoPage() {
  const bundle = northbeamBundle();
  // One step carries an unconfirmed estimate, so the publish check can be tried.
  bundle.steps = bundle.steps.map((s) => (s.id === northbeamStepIds.audit ? { ...s, assumption: true } : s));
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={`${bundle.workspace.name} · demo`} signedIn={false} />
      <p className="mt-3 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
        Demo mode: sample data from the seed fixtures, not a database. Edit the map freely: edits open a draft you can
        compare with live, publish or discard. Everything stays in this tab and is gone when you reload.
      </p>
      <h1 className="mt-4 mb-3 text-xl font-bold">{bundle.process.name}</h1>
      <ProcessView live={bundle} draft={null} mode="demo" />
    </main>
  );
}
