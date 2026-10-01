"use client";

// Issues on the process page (issue #17): the Issues tab in the map's Insights panel, badges on the steps, Kept out of process-view.tsx so that file only wires it in.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IssueRow, ProcessBundle, ScenarioRow } from "@transpera-flow/db";
import { detectBrokenScenarios, type AnalysisSettings, type EngineModel, type RetiredSteps, type SimulationResult } from "@transpera-flow/engine";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { visibleFindings } from "@/lib/rules/edit";
import { useDetectedIssues } from "@/lib/issues/use-detected";
import { useRatingSettings } from "@/lib/rules/use-rating-settings";
import { entryView, promoteInput, registerEntries, stepBadges } from "@/lib/issues/register";
import { useIssues } from "@/lib/issues/use-issues";
import { IssuesRegister } from "./issues-register";
import type { EditMode } from "./process-view";
import { StepIssueBadges } from "./step-issue-badges";

export interface ProcessIssues {
  /** Badges on the map's steps (portals; render anywhere). */
  badges: ReactNode;
  /** The Insights panel: `utilisation` in one tab, the issues in another. */
  rail: (utilisation: ReactNode) => ReactNode;
  /** Switch the rail to its Issues tab (the sidebar's Issues item, on the demo). */
  showIssues: () => void;
  /** The scenario panel reports its saved scenarios here, so issues can link and run them. */
  onScenariosChange: (scenarios: ScenarioRow[]) => void;
  /** The saved scenarios as the scenario panel last reported them. */
  scenarios: ScenarioRow[];
}

const NO_RETIRED: RetiredSteps = {};

export function useProcessIssues({
  bundle,
  model,
  result,
  running,
  mode,
  initialIssues,
  initialScenarios,
  registerHref,
  retired = NO_RETIRED,
  analysisRules,
  onShowIssues,
}: {
  bundle: ProcessBundle;
  model: EngineModel | null;
  result: SimulationResult | null;
  running: boolean;
  mode: EditMode;
  initialIssues: IssueRow[];
  initialScenarios: ScenarioRow[];
  /** Link to the full register page, if there is one. */
  registerHref?: string;
  /** Steps the model no longer has and what replaced them, for broken-scenario issues (issue #16). */
  retired?: RetiredSteps;
  /** The workspace's analysis rules (Settings → Analysis rules); omitted means the defaults. On the demo, the ones edited in this tab. */
  analysisRules?: AnalysisSettings;
  /** A step's issue badge was clicked: the caller opens the panel the Issues tab is in. */
  onShowIssues?: () => void;
}): ProcessIssues {
  const state = useIssues(bundle.workspace.id, initialIssues, mode);
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [tab, setTab] = useState<"utilisation" | "issues">("utilisation");
  const [stepFilter, setStepFilter] = useState("");

  // Saved scenarios whose targets no longer resolve raise a broken_scenario issue each (issue #16).
  const broken = useMemo(() => (model ? detectBrokenScenarios(model, scenarios, retired) : []), [model, scenarios, retired]);
  // A change to the rules re-rates this run (and drops what a switched-off rule found); it is not simulated again.
  const rules = useRatingSettings(mode === "demo", analysisRules);
  // Perception gaps from the steps' evidence (issue #21), unless that rule is off.
  const gaps = useMemo(() => visibleFindings(rules, perceptionGapDetections(bundle.steps)), [bundle.steps, rules]);
  const found = useDetectedIssues(model, result, rules, bundle.process.id, bundle.workspace.settings.currency);
  const detected = useMemo(() => (found ? visibleFindings(rules, [...broken, ...found, ...gaps]) : null), [found, broken, gaps, rules]);
  const brokenScenarios = useMemo(() => new Set(broken.flatMap((d) => (d.scenarioId ? [d.scenarioId] : []))), [broken]);

  // A tracked broken-scenario issue resolves itself once its scenario is fixed (re-pointed or deleted).
  const resolving = useRef(new Set<string>());
  const { issues: tracked, saver, promote } = state;
  useEffect(() => {
    if (mode === "readonly" || !model) return;
    const still = new Set(broken.map((d) => d.key));
    for (const i of tracked) {
      if (i.type !== "broken_scenario" || !i.detected_key || still.has(i.detected_key)) continue;
      if ((i.status !== "open" && i.status !== "in_progress") || resolving.current.has(i.id)) continue;
      resolving.current.add(i.id);
      void saver(i.id, "status")(i.status, "done").finally(() => resolving.current.delete(i.id));
    }
  }, [mode, model, broken, tracked, saver]);

  // The database logs a perception gap as a tracked issue when it is saved; the demo has no database, so it tracks it here.
  const logged = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== "demo") return;
    for (const g of gaps) {
      if (logged.current.has(g.key) || tracked.some((i) => i.detected_key === g.key)) continue;
      logged.current.add(g.key);
      void promote(promoteInput(g, bundle.process.id, scenarios));
    }
  }, [mode, gaps, tracked, promote, bundle.process.id, scenarios]);
  const entries = useMemo(() => registerEntries(state.issues, detected ?? []), [state.issues, detected]);
  // Issues on this process, or on none in particular.
  const here = useMemo(
    () => entries.filter((e) => e.kind === "detected" || !e.issue.process_id || e.issue.process_id === bundle.process.id),
    [entries, bundle.process.id],
  );
  const badges = useMemo(() => stepBadges(here), [here]);
  const openCount = here.filter((e) => entryView(e).open).length;

  const steps = bundle.steps.filter((s) => s.kind !== "start" && s.kind !== "end").map((s) => ({ id: s.id, name: s.name }));
  const people = bundle.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  const rail = (utilisation: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="tablist" aria-label="Insights" className="flex gap-0.5 self-start rounded-md bg-muted p-0.5">
        {(
          [
            ["utilisation", "Utilisation"],
            ["issues", `Issues${detected === null ? "" : ` · ${openCount}`}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rail-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`rail-panel-${id}`}
            onClick={() => setTab(id)}
            className={`rounded-sm px-2.5 py-1 text-xs ${tab === id ? "bg-panel font-semibold text-fg shadow-token" : "text-muted-foreground hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`rail-panel-${tab}`} aria-labelledby={`rail-tab-${tab}`} className="min-w-0">
        {tab === "utilisation" ? (
          utilisation
        ) : (
          <div>
            <IssuesRegister
              layout="rail"
              state={state}
              detected={detected}
              running={running}
              processId={bundle.process.id}
              processes={[{ id: bundle.process.id, name: bundle.process.name }]}
              steps={steps}
              people={people}
              scenarios={scenarios}
              brokenScenarios={brokenScenarios}
              canEdit={mode !== "readonly"}
              currency={bundle.workspace.settings.currency}
              stepFilter={stepFilter}
              onStepFilterChange={setStepFilter}
            />
            {registerHref && (
              <a href={registerHref} className="mt-2 block text-xs text-fg-2 hover:underline">
                Open the full register →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return {
    badges: (
      <StepIssueBadges
        badges={badges}
        onOpen={(id) => {
          setStepFilter(id);
          setTab("issues");
          onShowIssues?.();
        }}
      />
    ),
    rail,
    showIssues: () => setTab("issues"),
    onScenariosChange: setScenarios,
    scenarios,
  };
}
