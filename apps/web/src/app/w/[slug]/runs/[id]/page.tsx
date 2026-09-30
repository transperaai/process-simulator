import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { EngineChangedNote, ModelChangedBanner, RunResultsTiles, RunSavedLine } from "@/components/runs-view";
import { loadRunPage } from "@/lib/company-data";

/** One saved run, with "model changed since this run" and the list of changes (docs/PRD.md §4.1, D19). */
export default async function RunPage(props: PageProps<"/w/[slug]/runs/[id]">) {
  const { slug, id } = await props.params;
  const data = await loadRunPage(slug, id);
  if (!data) notFound();
  const { run } = data;
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 flex gap-4 text-fg-2">
        <Link href={`/w/${slug}`} className="hover:underline">
          ← Back to the process
        </Link>
        <Link href={`/w/${slug}/runs`} className="hover:underline">
          All saved runs
        </Link>
      </nav>
      <h1 className="mt-2 text-xl font-bold">{run.name}</h1>
      <div className="mb-3">
        <RunSavedLine run={run} />
      </div>
      <div className="flex flex-col gap-3">
        <ModelChangedBanner changes={data.changes} rerunHref={`/w/${slug}`} />
        <EngineChangedNote version={run.engine_version} />
        <RunResultsTiles results={run.results} />
      </div>
    </main>
  );
}
