import { Page } from "@/components/shell/page";
import { demoBundle } from "@/lib/sources/demo";
import { ChurnDriversSettings } from "../../w/[slug]/settings/churn-drivers-settings";

/** Settings, Churn drivers on the demo: Northbeam's clients simulated in this tab, with weights you can move. Nothing is saved. */
export default function DemoChurnDriversPage() {
  return (
    <Page title="Churn drivers" eyebrow="Company" description="Demo mode: Northbeam's sample numbers. Your changes stay in this tab, gone when you reload.">
      <ChurnDriversSettings mode="demo" workspaceId={null} bundle={demoBundle()} rows={[]} />
    </Page>
  );
}
