import { redirect } from "next/navigation";
import { DemoOverview } from "@/components/overview/demo-overview";
import { demoLandingRedirect } from "@/lib/demo/landing";

/**
 * The Northbeam sample from the seed fixtures, no database needed. It opens on the Overview (issue #100).
 * The links that used to open a map here still work: `?process=<id>` goes to `/demo/p/<id>`, and `?nested=1`
 * to the pipeline drawn with two groups of steps (issue #102).
 */
export default async function DemoPage(props: PageProps<"/demo">) {
  const { process, nested } = await props.searchParams;
  const to = demoLandingRedirect(process, nested);
  if (to) redirect(to);
  return <DemoOverview />;
}
