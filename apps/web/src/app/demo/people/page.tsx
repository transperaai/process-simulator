import { PeoplePage } from "@/components/people-page";
import { Page } from "@/components/shell/page";
import { demoBundle } from "@/lib/sources/demo";

/** The People page on the demo: Northbeam's client health and how busy each person is, simulated in this tab. */
export default function DemoPeoplePage() {
  return (
    <Page
      title="People"
      eyebrow="Company"
      description="How healthy your clients are, and how busy each person is, from a simulation of the live process. Demo mode: Northbeam's sample numbers."
      width="max-w-6xl"
    >
      <PeoplePage bundle={demoBundle()} settingsHref={null} />
    </Page>
  );
}
