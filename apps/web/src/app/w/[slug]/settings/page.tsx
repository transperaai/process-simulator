import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { loadWorkspaceSettings } from "@/lib/data";
import { ClientGroupsSettings } from "./client-groups-settings";
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
    <Page
      title="Settings"
      eyebrow="Company"
      description="Changes save as you go. If someone else changes the same field at the same time, you'll be asked which value to keep."
    >
      <SimulationSettings data={data} />
      <RolesSettings data={data} />
      <ServicesSettings data={data} />
      <ClientGroupsSettings data={data} />
      <HealthSettings data={data} />
      <DemandSettings data={data} />
      <PeopleSettings data={data} />
    </Page>
  );
}
