import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { loadWorkspaceSettings } from "@/lib/data";
import { DemandSettings } from "./demand-settings";
import { PeopleSettings, SimulationSettings } from "./people-settings";
import { RolesSettings } from "./roles-settings";
import { ServicesSettings } from "./services-settings";
import { HealthSettings } from "./servicing-settings";

export default async function WorkspaceSettingsPage(props: PageProps<"/w/[slug]/settings">) {
  const { slug } = await props.params;
  const data = await loadWorkspaceSettings(slug);
  if (!data) notFound();
  return (
    <div>
      <ShellHeader title="Settings" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Workspace settings</h1>
        <p className="mb-6 text-fg-2">
          Changes save as you go. If someone else changes the same field at the same time, you&apos;ll be asked which
          value to keep.
        </p>
        <SimulationSettings data={data} />
        <RolesSettings data={data} />
        <ServicesSettings data={data} />
        <HealthSettings data={data} />
        <DemandSettings data={data} />
        <PeopleSettings data={data} />
      </div>
    </div>
  );
}
