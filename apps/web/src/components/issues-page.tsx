"use client";

// The full issues register screen: tracked issues from the database plus what
// a fresh run of the live process detects (in a worker, as on the process
// page).
import { useMemo, useState } from "react";
import { ModelError, toEngineModel, type IssueRow, type ProcessBundle, type ScenarioRow } from "@transpera-flow/db";
import { detectBrokenScenarios, resolveMoney, type AnalysisSettings } from "@transpera-flow/engine";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { visibleFindings } from "@/lib/rules/edit";
import { useDetectedIssues } from "@/lib/issues/use-detected";
import { useRatingSettings } from "@/lib/rules/use-rating-settings";
import { useIssues } from "@/lib/issues/use-issues";
import { useSuccessMeasures } from "@/lib/first-principles/use-measures";
import type { FirstPrinciples } from "@transpera-flow/engine";
import { retiredSteps } from "@/lib/scenarios/broken";
import { useAbsenceTest } from "@/lib/sim/absence";
import { useSimulation } from "@/lib/sim/use-simulation";
import { Card } from "@/components/ui/card";
import { IssuesRegister, type Named } from "./issues-register";

export function IssuesPage({
  bundle,
  issues,
  scenarios,
  processes,
  mode,
  analysisRules,
  firstPrinciples,
}: {
  bundle: ProcessBundle;
  /** The live version's first principles, whose success measures rule 11 (goals met) rates. */
  firstPrinciples?: FirstPrinciples | null;
  issues: IssueRow[];
  scenarios: ScenarioRow[];
  processes: Named[];
  mode: "live" | "demo" | "readonly";
  /** The workspace's analysis rules (Settings → Analysis rules); omitted means the defaults. On the demo, the ones edited in this tab. */
  analysisRules?: AnalysisSettings;
}) {
  const state = useIssues(bundle.workspace.id, issues, mode);
  const [stepFilter, setStepFilter] = useState("");
  const model = useMemo(() => {
    try {
      return toEngineModel(bundle);
    } catch (err) {
      if (err instanceof ModelError) return null;
      throw err;
    }
  }, [bundle]);
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;
  // Saved scenarios that no longer resolve against the live model raise a broken_scenario issue each (issue #16).
  const broken = useMemo(() => (model ? detectBrokenScenarios(model, scenarios, retiredSteps(bundle)) : []), [model, scenarios, bundle]);
  // Perception gaps come from the steps' evidence, not the run (issue #21).
  const gaps = useMemo(() => perceptionGapDetections(bundle.steps), [bundle.steps]);
  // A change to the rules re-rates this run; it is not simulated again.
  const rules = useRatingSettings(mode === "demo", analysisRules);
  // The absence test (rule 8) runs in its own worker once the baseline is done; until it returns, that rule raises nothing.
  const absence = useAbsenceTest(model && result && sim.status === "done" ? model : null, result?.seed ?? 1, resolveMoney(rules).absenceWeeks);
  const successMeasures = useSuccessMeasures(bundle.process.id, mode === "demo", firstPrinciples);
  const found = useDetectedIssues(model, result, rules, bundle.process.id, bundle.workspace.settings.currency, absence, successMeasures);
  const detected = useMemo(
    () => (model && !result ? null : visibleFindings(rules, found ? [...broken, ...found, ...gaps] : gaps)),
    [model, result, found, broken, gaps, rules],
  );
  const brokenScenarios = useMemo(() => new Set(broken.flatMap((d) => (d.scenarioId ? [d.scenarioId] : []))), [broken]);

  return (
    <Card className="px-4">
      <IssuesRegister
        layout="page"
        state={state}
        detected={detected}
        running={sim.status === "running"}
        processId={bundle.process.id}
        processes={processes}
        steps={bundle.steps.filter((s) => s.kind !== "start" && s.kind !== "end").map((s) => ({ id: s.id, name: s.name }))}
        people={bundle.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))}
        scenarios={scenarios}
        brokenScenarios={brokenScenarios}
        canEdit={mode !== "readonly"}
        currency={bundle.workspace.settings.currency}
        stepFilter={stepFilter}
        onStepFilterChange={setStepFilter}
      />
    </Card>
  );
}
