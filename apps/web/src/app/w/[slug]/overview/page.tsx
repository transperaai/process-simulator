import { OverviewSoon } from "@/components/shell/placeholders";

/** Placeholder until A35 builds the Overview page (issue #98). */
export default async function OverviewPage(props: PageProps<"/w/[slug]/overview">) {
  const { slug } = await props.params;
  return <OverviewSoon mapHref={`/w/${slug}`} />;
}
