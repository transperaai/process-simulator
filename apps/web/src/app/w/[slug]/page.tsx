import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, canManageWorkspace, currentViewer } from "@/lib/access-data";
import { loadProcessForEditing } from "@/lib/data";

export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const process = await loadProcessForEditing(slug);
  if (!process) notFound();
  const { live, draft } = process;
  const [canEdit, canManage, viewer] = await Promise.all([
    canEditWorkspace(live.workspace.id),
    canManageWorkspace(live.workspace.id),
    currentViewer(),
  ]);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={live.workspace.name} signedIn />
      <div className="mt-4 mb-3 flex items-baseline gap-4">
        <h1 className="text-xl font-bold">{live.process.name}</h1>
        <Link href={`/w/${slug}/settings`} className="text-fg-2 hover:underline">
          People &amp; settings
        </Link>
        {canManage && (
          <Link href={`/w/${slug}/settings/access`} className="text-fg-2 hover:underline">
            Access
          </Link>
        )}
      </div>
      <ProcessView live={live} draft={draft} mode={canEdit ? "live" : "readonly"} userId={viewer?.userId ?? null} viewer={viewer} />
    </main>
  );
}
