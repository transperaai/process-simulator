import { LibrarySoon } from "@/components/shell/placeholders";

/** Placeholder until A51 builds the block library (issue #98). */
export default async function LibraryPage(props: PageProps<"/w/[slug]/library">) {
  const { slug } = await props.params;
  return <LibrarySoon mapHref={`/w/${slug}`} />;
}
