import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { loadWorkspaceSettings } from "@/lib/data";
import { DemandSettings } from "./demand-settings";
import { PeopleSettings, SimulationSettings } from "./people-settings";
import { ServicesSettings } from "./services-settings";

export default async function WorkspaceSettingsPage(props: PageProps<"/w/[slug]/settings">) {
  const { slug } = await props.params;
  const data = await loadWorkspaceSettings(slug);
  if (!data) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 text-fg-2">
        <Link href={`/w/${slug}`} className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Workspace settings</h1>
      <p className="mb-6 text-fg-2">
        Changes save as you go. If someone else changes the same field at the same time, you&apos;ll be asked which
        value to keep.
      </p>
      <SimulationSettings data={data} />
      <ServicesSettings data={data} />
      <DemandSettings data={data} />
      <PeopleSettings data={data} />
    </main>
  );
}
