import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProcessView } from "@/components/process-view";
import { loadLiveProcess } from "@/lib/data";

export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const bundle = await loadLiveProcess(slug);
  if (!bundle) notFound();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8">
      <AppHeader workspace={bundle.workspace.name} signedIn />
      <h1 className="mt-4 mb-3 text-xl font-bold">{bundle.process.name}</h1>
      <ProcessView bundle={bundle} />
    </main>
  );
}
