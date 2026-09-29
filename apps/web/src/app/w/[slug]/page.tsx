import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProcessView } from "@/components/process-view";
import { canEditWorkspace, canManageWorkspace, currentUserId } from "@/lib/access-data";
import { loadLiveProcess } from "@/lib/data";

export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  const [canEdit, canManage, userId] = await Promise.all([
    canEditWorkspace(bundle.workspace.id),
    canManageWorkspace(bundle.workspace.id),
    currentUserId(),
  ]);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={bundle.workspace.name} signedIn />
      <div className="mt-4 mb-3 flex items-baseline gap-4">
        <h1 className="text-xl font-bold">{bundle.process.name}</h1>
        <Link href={`/w/${slug}/settings`} className="text-fg-2 hover:underline">
          People &amp; settings
        </Link>
        {canManage && (
          <Link href={`/w/${slug}/settings/access`} className="text-fg-2 hover:underline">
            Access
          </Link>
        )}
      </div>
      <ProcessView bundle={bundle} mode={canEdit ? "live" : "readonly"} userId={userId} />
    </main>
  );
}
