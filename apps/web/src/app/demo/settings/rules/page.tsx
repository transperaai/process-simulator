import { processesOf } from "@transpera-flow/db";
import { AnalysisRulesSettings } from "@/components/rules/analysis-rules-settings";
import { demoBundle } from "@/lib/sources/demo";

/** Settings -> Analysis rules on the demo: Northbeam's latest run is rated live as the rules change; nothing is saved. */
export default function DemoAnalysisRulesPage() {
  const bundle = demoBundle();
  return (
    <AnalysisRulesSettings
      mode="demo"
      workspaceId={null}
      initial={{ settings: {}, version: null }}
      bundle={bundle}
      processes={processesOf(bundle).map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
