import { redirect } from "next/navigation";
import { NORTHBEAM_PROCESS_ID } from "@transpera-flow/db";
import { DemoOverview } from "@/components/overview/demo-overview";

/**
 * The Northbeam sample from the seed fixtures, no database needed. It opens on the Overview (issue #100).
 * The links that used to open a map here still work: `?process=<id>` goes to `/demo/p/<id>`, and `?nested=1`
 * to the pipeline drawn with two groups of steps (issue #102).
 */
export default async function DemoPage(props: PageProps<"/demo">) {
  const { process, nested } = await props.searchParams;
  if (typeof process === "string") redirect(`/demo/p/${encodeURIComponent(process)}${nested === "1" ? "?nested=1" : ""}`);
  if (nested === "1") redirect(`/demo/p/${NORTHBEAM_PROCESS_ID}?nested=1`);
  return <DemoOverview />;
}
