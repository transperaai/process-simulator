import { Page } from "@/components/shell/page";
import type { WorkspaceSettingsData } from "@/lib/data";
import { demoMarket } from "@/lib/market-demo";
import { MarketSettings } from "../../w/[slug]/settings/market-settings";

/** Settings, Market conditions on the demo: sample conditions and a schedule, read-only. */
export default function DemoMarketPage() {
  const { workspaceId, marketConditions, marketSchedule } = demoMarket();
  // Only what the market section reads.
  const data = { workspace: { id: workspaceId }, canEdit: false, marketConditions, marketSchedule } as unknown as WorkspaceSettingsData;
  return (
    <Page title="Market conditions" eyebrow="Company" description="Demo mode: sample conditions and a sample schedule, read-only.">
      <MarketSettings data={data} />
    </Page>
  );
}
