import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { SourcesPage } from "@/components/sources-page";
import { demoBundle, demoCitations, demoSources } from "@/lib/sources/demo";

/** The Sources screen on the demo: Northbeam's sample sources, in memory. */
export default function DemoSourcesPage() {
  const bundle = demoBundle();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={`${bundle.workspace.name} · demo`} signedIn={false} />
      <nav className="mt-4 text-fg-2">
        <Link href="/demo" className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Sources</h1>
      <p className="mb-4 text-fg-2">
        What the audit recorded, and every number that cites it. Demo mode: changes stay in this tab and are gone when you
        reload.
      </p>
      <SourcesPage workspaceId={bundle.workspace.id} sources={demoSources()} citations={demoCitations(bundle)} mode="demo" processHref="/demo" />
    </main>
  );
}
