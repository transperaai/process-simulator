import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { LiveRoster } from "@/components/roster-views";
import { loadRoster } from "@/lib/data";

/** The client roster (docs/PRD.md §8 screen 5; issue #18). */
export default async function ClientsPage(props: PageProps<"/w/[slug]/clients">) {
  const { slug } = await props.params;
  const data = await loadRoster(slug);
  if (!data) notFound();
  return (
    <div>
      <ShellHeader title="Clients" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Clients</h1>
        <LiveRoster data={data} />
      </div>
    </div>
  );
}
