import { notFound } from "next/navigation";
import { ProcessesList } from "@/components/shell/placeholders";
import { loadProcessList, loadWorkspaceHead } from "@/lib/data";

/** Every process of the workspace, each opening its map (issue #98). A36 adds nesting and per-process cards. */
export default async function ProcessesPage(props: PageProps<"/w/[slug]/processes">) {
  const { slug } = await props.params;
  const workspace = await loadWorkspaceHead(slug);
  if (!workspace) notFound();
  const processes = await loadProcessList(workspace.id);
  return <ProcessesList processes={processes.map((p) => ({ ...p, href: `/w/${slug}/p/${p.id}` }))} />;
}
