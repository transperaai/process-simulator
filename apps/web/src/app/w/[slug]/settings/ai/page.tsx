import { notFound } from "next/navigation";
import { AiSettingsPage } from "@/components/ai/ai-settings";
import { canEditWorkspace } from "@/lib/access-data";
import { loadWorkspaceAiSettings, aiConfigured } from "@/lib/ai/data";
import { loadWorkspaceHead } from "@/lib/data";

/**
 * Settings -> AI analysis (issue #111, A46): five switches, stored per workspace. Everyone in the workspace sees them;
 * owners and editors change them.
 */
export default async function AiSettingsRoute(props: PageProps<"/w/[slug]/settings/ai">) {
  const { slug } = await props.params;
  const head = await loadWorkspaceHead(slug);
  if (!head) notFound();
  const [canEdit, settings] = await Promise.all([canEditWorkspace(head.id), loadWorkspaceAiSettings(head.id)]);
  return <AiSettingsPage mode={canEdit ? "live" : "readonly"} workspaceId={head.id} initial={settings} configured={aiConfigured()} />;
}
