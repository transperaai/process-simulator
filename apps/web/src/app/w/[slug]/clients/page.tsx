import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { LiveRoster } from "@/components/roster-views";
import { loadRoster } from "@/lib/data";

/** The client roster (docs/PRD.md §8 screen 5; issue #18). */
export default async function ClientsPage(props: PageProps<"/w/[slug]/clients">) {
  const { slug } = await props.params;
  const data = await loadRoster(slug);
  if (!data) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 text-fg-2">
        <Link href={`/w/${slug}`} className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Clients</h1>
      <LiveRoster data={data} />
    </main>
  );
}
