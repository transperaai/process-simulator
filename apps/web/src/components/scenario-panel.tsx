"use client";

// Levers, saved scenarios and the compare view under the process map (issue
// #15). The scenario is the baseline model with the applied scenarios'
// patches (in the order applied) and then the moved levers on top. It runs in
// its own worker with the baseline's seed and replication count, so the two
// runs pair up replication by replication.

import { useMemo, useState } from "react";
import type { ScenarioRow } from "@transpera-flow/db";
import { applyPatches, compareHeadline, compareRuns, type EngineModel, type EnginePerson } from "@transpera-flow/engine";
import { buildLevers, leverPatches, type LeverValues } from "@/lib/scenarios/levers";
import { liveScenarioStore } from "@/lib/scenarios/live-store";
import { copyName, headlineSubject, scenarioProblems } from "@/lib/scenarios/scenarios";
import { MemoryScenarioStore, type ScenarioStore } from "@/lib/scenarios/store";
import type { SimRun } from "@/lib/sim/client";
import { useSimulation } from "@/lib/sim/use-simulation";
import { formatNumber } from "@/lib/format";
import { CompareView } from "./compare-view";
import { LeverPanel } from "./lever-panel";
import type { EditMode } from "./process-view";
import { RobustnessCheck } from "./robustness-check";
import { ScenarioLibrary } from "./scenario-library";

const NO_STEPS: readonly { id: string; provenance?: unknown }[] = [];

export function ScenarioPanel({
  model,
  baseline,
  currency,
  workspaceId,
  initialScenarios,
  mode,
  steps = NO_STEPS,
}: {
  /** The baseline model (the process as it is now). */
  model: EngineModel;
  /** The baseline's latest run (30 replications, seed 1). */
  baseline: SimRun | null;
  currency: string;
  workspaceId: string;
  initialScenarios: ScenarioRow[];
  /** `live` saves to the database, `demo` in memory, `readonly` not at all (viewers still apply and compare). */
  mode: EditMode;
  /** Step rows, for the robustness check: their provenance says which values are estimated. */
  steps?: readonly { id: string; provenance?: unknown }[];
}) {
  const canEdit = mode !== "readonly";
  const [store] = useState<ScenarioStore>(() => (mode === "live" ? liveScenarioStore(workspaceId) : new MemoryScenarioStore(workspaceId)));
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [stackIds, setStackIds] = useState<string[]>([]);
  const [values, setValues] = useState<LeverValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = useMemo(() => Object.fromEntries(scenarios.map((s) => [s.id, scenarioProblems(model, s)])), [model, scenarios]);
  const stack = useMemo(
    () => stackIds.map((id) => scenarios.find((s) => s.id === id)).filter((s): s is ScenarioRow => Boolean(s)),
    [stackIds, scenarios],
  );
  const usable = useMemo(() => stack.filter((s) => !problems[s.id]?.length), [stack, problems]);
  const left = stack.filter((s) => problems[s.id]?.length);

  // Levers act on the model with the applied scenarios in it.
  const stacked = useMemo(() => applyPatches(model, usable.flatMap((s) => s.patch)).model, [model, usable]);
  const levers = useMemo(() => buildLevers(stacked), [stacked]);
  const moved = useMemo(() => leverPatches(levers, values), [levers, values]);
  const patches = useMemo(() => [...usable.flatMap((s) => s.patch), ...moved], [usable, moved]);
  const applied = useMemo(() => (patches.length ? applyPatches(model, patches) : null), [model, patches]);

  // Only a change to the scenario model re-runs it.
  const key = applied ? JSON.stringify(applied.model) : null;
  const scenarioModel = useMemo(() => (key ? (JSON.parse(key) as EngineModel) : null), [key]);
  const sim = useSimulation(scenarioModel);
  const run = scenarioModel ? sim.run : null;

  const roleNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const [id, r] of Object.entries(model.roles)) names[id] = r.name;
    return names;
  }, [model]);
  const comparison = baseline && run ? compareRuns(baseline.result, run.result) : null;
  const subject = headlineSubject(
    usable.map((s) => s.name),
    moved.length > 0,
  );
  const headline = comparison
    ? compareHeadline({ comparison, ...subject, horizonWeeks: model.horizonWeeks, hoursPerWeek: model.hoursPerWeek, currency, roleNames })
    : null;
  const people: Record<string, EnginePerson> = { ...baseline?.result.resolvedPeople, ...run?.result.resolvedPeople };
  const notes = [
    ...left.map((s) => `“${s.name}” needs attention and is left out: ${problems[s.id]!.map((p) => p.message).join(" ")}`),
    ...(applied?.issues ?? []).map((i) => i.message),
  ];

  const status = !scenarioModel
    ? "Every change re-runs the simulation."
    : sim.status === "running"
      ? "Simulating…"
      : sim.status === "error"
        ? "Simulation failed"
        : `Re-ran in ${formatNumber(sim.run?.durationMs ?? 0, 0)} ms`;

  const create = async (input: Parameters<ScenarioStore["create"]>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await store.create(input);
      if (r.status === "error") {
        setError(r.message);
        return null;
      }
      setScenarios((list) => [...list, r.scenario]);
      return r.scenario;
    } catch {
      setError("Couldn't save. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
      <LeverPanel
        levers={levers}
        values={values}
        currency={currency}
        status={status}
        onChange={(path, v) =>
          setValues((prev) => {
            const next = { ...prev };
            if (v === undefined) delete next[path];
            else next[path] = v;
            return next;
          })
        }
        onReset={() => setValues({})}
      />
      <div className="flex min-w-0 flex-col gap-3">
        <CompareView
          comparison={comparison}
          headline={headline}
          roleNames={roleNames}
          people={people}
          currency={currency}
          hoursPerWeek={model.hoursPerWeek}
          horizonWeeks={model.horizonWeeks}
          running={Boolean(scenarioModel) && sim.status === "running"}
          notes={notes}
          robustness={
            <RobustnessCheck
              model={model}
              scenario={patches}
              steps={steps}
              subject={subject.subject}
              plural={subject.plural}
              roleNames={roleNames}
              currency={currency}
            />
          }
        />
        <ScenarioLibrary
          scenarios={scenarios}
          model={model}
          stack={stackIds}
          problems={problems}
          canEdit={canEdit}
          leverCount={moved.length}
          busy={busy}
          error={error}
          onToggle={(id) => setStackIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
          onClear={() => setStackIds([])}
          onSave={async (name, description) => {
            // The levers were set on top of the applied scenarios, so the new
            // scenario joins the end of the stack and the view doesn't change.
            const saved = await create({ name, description, patch: moved, parent_scenario_id: null });
            if (!saved) return false;
            setStackIds((ids) => [...ids, saved.id]);
            setValues({});
            return true;
          }}
          onDuplicate={(id) => {
            const source = scenarios.find((s) => s.id === id);
            if (!source) return;
            void create({
              name: copyName(source.name, scenarios.map((s) => s.name)),
              description: source.description,
              patch: source.patch,
              parent_scenario_id: source.id,
            });
          }}
          onDelete={async (id) => {
            setBusy(true);
            setError(null);
            try {
              const r = await store.remove(id);
              if (r.status === "error") return setError(r.message);
              setScenarios((list) => list.filter((s) => s.id !== id));
              setStackIds((ids) => ids.filter((x) => x !== id));
            } catch {
              setError("Couldn't delete. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}
