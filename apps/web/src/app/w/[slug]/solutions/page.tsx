import { SolutionsSoon } from "@/components/shell/placeholders";

/** Placeholder until A49 and A50 build solutions and their list (issue #98). */
export default async function SolutionsPage(props: PageProps<"/w/[slug]/solutions">) {
  const { slug } = await props.params;
  return <SolutionsSoon issuesHref={`/w/${slug}/issues`} />;
}
