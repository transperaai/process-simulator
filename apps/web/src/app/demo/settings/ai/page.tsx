import { DEFAULT_AI_SETTINGS } from "@transpera-flow/db";
import { AiSettingsPage } from "@/components/ai/ai-settings";

/** Settings -> AI analysis on the demo: the switches stay in this tab, and nothing calls an AI. */
export default function DemoAiSettingsPage() {
  return <AiSettingsPage mode="demo" workspaceId={null} initial={{ ...DEFAULT_AI_SETTINGS }} configured />;
}
