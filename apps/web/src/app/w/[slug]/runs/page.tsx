import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { RunsTable } from "@/components/runs-view";
import { loadRunsPage } from "@/lib/company-data";

/** Saved runs (issue #25): each flags whether the model has changed since it ran. */
export default async function RunsPage(props: PageProps<"/w/[slug]/runs">) {
  const { slug } = await props.params;
  const data = await loadRunsPage(slug);
  if (!data) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 text-fg-2">
        <Link href={`/w/${slug}`} className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Saved runs</h1>
      <p className="mb-4 text-fg-2">
        Runs keep their results and a snapshot of the model behind them. Open one to see what has changed in the model since.
      </p>
      <RunsTable runs={data.runs} hrefFor={(id) => `/w/${slug}/runs/${id}`} />
    </main>
  );
}
