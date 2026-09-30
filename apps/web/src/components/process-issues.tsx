"use client";

// Issues on the process page (issue #17): the Issues tab in the rail beside
// the map, badges on the steps, and the "Run the fix" request handed to the
// scenario panel. Kept out of process-view.tsx so that file only wires it in.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IssueRow, ProcessBundle, ScenarioRow } from "@transpera-flow/db";
import { detectIssues, type EngineModel, type SimulationResult } from "@transpera-flow/engine";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { entryView, fixFor, promoteInput, registerEntries, stepBadges, type FixRequest } from "@/lib/issues/register";
import { useIssues } from "@/lib/issues/use-issues";
import { IssuesRegister } from "./issues-register";
import type { EditMode } from "./process-view";
import { StepIssueBadges } from "./step-issue-badges";

export interface ProcessIssues {
  /** Badges on the map's steps (portals; render anywhere). */
  badges: ReactNode;
  /** The rail beside the map: `utilisation` in one tab, the issues in another. */
  rail: (utilisation: ReactNode) => ReactNode;
  /** The latest "Run the fix" request, for the scenario panel. */
  fix: FixRequest | null;
  /** The scenario panel reports its saved scenarios here, so issues can link and run them. */
  onScenariosChange: (scenarios: ScenarioRow[]) => void;
}

export function useProcessIssues({
  bundle,
  model,
  result,
  running,
  mode,
  initialIssues,
  initialScenarios,
  initialFix,
  registerHref,
}: {
  bundle: ProcessBundle;
  model: EngineModel | null;
  result: SimulationResult | null;
  running: boolean;
  mode: EditMode;
  initialIssues: IssueRow[];
  initialScenarios: ScenarioRow[];
  /** An issue id or detected key whose fix to run once the first run is in (`?fix=` from the register page). */
  initialFix?: string | null;
  /** Link to the full register page, if there is one. */
  registerHref?: string;
}): ProcessIssues {
  const state = useIssues(bundle.workspace.id, initialIssues, mode);
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [fix, setFix] = useState<FixRequest | null>(null);
  const [tab, setTab] = useState<"utilisation" | "issues">(initialFix ? "issues" : "utilisation");
  const [stepFilter, setStepFilter] = useState("");

  // What the run detects, and perception gaps from the steps' evidence (issue #21).
  const gaps = useMemo(() => perceptionGapDetections(bundle.steps), [bundle.steps]);
  const detected = useMemo(() => (model && result ? [...detectIssues(model, result), ...gaps] : null), [model, result, gaps]);
  // The database logs a perception gap as a tracked issue when it is saved; the demo has no database, so it tracks it here.
  const logged = useRef(new Set<string>());
  const { issues: tracked, promote } = state;
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

  const runFix = (f: Omit<FixRequest, "nonce">) => setFix({ ...f, nonce: Date.now() });

  // Arriving from the register page with ?fix=: run it once the detections are in.
  const [pendingFix, setPendingFix] = useState(initialFix ?? null);
  if (pendingFix && detected !== null) {
    const entry = entries.find((e) => (e.kind === "tracked" ? e.issue.id === pendingFix || e.issue.detected_key === pendingFix : e.detection.key === pendingFix));
    const f = entry ? fixFor(entry, scenarios) : null;
    setPendingFix(null);
    if (f) setFix({ ...f, nonce: 0 });
  }

  const steps = bundle.steps.filter((s) => s.kind !== "start" && s.kind !== "end").map((s) => ({ id: s.id, name: s.name }));
  const people = bundle.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  const rail = (utilisation: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="tablist" aria-label="Beside the map" className="flex gap-0.5 self-start rounded-token border border-line bg-panel p-0.5 shadow-token">
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
            className={`rounded px-2.5 py-0.5 text-sm ${tab === id ? "bg-accent font-semibold text-accent-fg" : "text-fg-2 hover:bg-panel-2"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`rail-panel-${tab}`} aria-labelledby={`rail-tab-${tab}`} className="min-w-0">
        {tab === "utilisation" ? (
          utilisation
        ) : (
          <div className="rounded-token border border-line bg-panel p-3 shadow-token">
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
              canEdit={mode !== "readonly"}
              stepFilter={stepFilter}
              onStepFilterChange={setStepFilter}
              onRunFix={runFix}
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
        }}
      />
    ),
    rail,
    fix,
    onScenariosChange: setScenarios,
  };
}
