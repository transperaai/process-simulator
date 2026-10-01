import { LeversSettings } from "@/components/levers/levers-settings";

/** Settings -> Levers on the demo: switching a lever off takes its sliders off the demo's process page; nothing is saved. */
export default function DemoLeversPage() {
  return <LeversSettings mode="demo" workspaceId={null} initial={{ hidden: [], version: null }} />;
}
