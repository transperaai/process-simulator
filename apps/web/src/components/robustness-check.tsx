"use client";

// "Check robustness" in the compare view (issue #20, docs/PRD.md §6.5): does
// the conclusion hold if the estimates are off by 25%? Runs in a worker pool
// with a progress bar and a cancel button; the verdict and the sensitive
// inputs come from the engine's fixed templates.

import { useMemo } from "react";
import { robustnessVerdict, type EngineModel, type ProvenanceRows, type RobustnessOptions, type ScenarioPatch } from "@transpera-flow/engine";
import { formatNumber } from "@/lib/format";
import { robustnessParameters } from "@/lib/robustness/session";
import { useRobustness } from "@/lib/robustness/use-robustness";

export function RobustnessCheck({
  model,
  scenario,
  provenance,
  subject,
  plural,
  roleNames,
  currency,
}: {
  /** The baseline model. */
  model: EngineModel;
  /** The patches that make the scenario (applied scenarios, then levers). */
  scenario: ScenarioPatch[];
  /** Step, service and workspace rows, for their provenance: entered or measured values are not perturbed. */
  provenance: ProvenanceRows;
  subject: string;
  plural: boolean;
  roleNames: Record<string, string>;
  currency: string;
}) {
  const input = useMemo(() => {
    const options: RobustnessOptions = { parameters: robustnessParameters(model, provenance) };
    return { model, scenario, options };
  }, [model, scenario, provenance]);
  const { state, start, cancel } = useRobustness(input);
  const inputs = input.options.parameters?.length ?? 0;
  const conflicted = input.options.parameters?.filter((p) => p.conflict).length ?? 0;

  const verdict =
    state.status === "done"
      ? robustnessVerdict({ result: state.result, subject, plural, roleNames, horizonWeeks: model.horizonWeeks, currency })
      : null;
  const share = state.status === "running" && state.progress ? state.progress.done / Math.max(1, state.progress.total) : 0;

  return (
    <div data-testid="robustness" className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Robustness</h3>
        {state.status === "running" ? (
          <button type="button" onClick={cancel} className="rounded-token border border-line-2 px-2 py-1 text-xs hover:bg-panel-2">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={!inputs}
            className="rounded-token bg-accent px-2 py-1 text-xs font-semibold text-accent-fg disabled:opacity-50"
          >
            {state.status === "done" ? "Check again" : "Check robustness"}
          </button>
        )}
      </div>

      {state.status === "idle" && (
        <p className="text-xs text-fg-3">
          {inputs
            ? `Re-runs both sides with each of the ${inputs} estimated inputs 25% lower and higher${conflicted ? ` (${conflicted} where sources disagree: across the range they gave)` : ""}, to see whether the answer holds. Takes 10–30 s.`
            : "Every input is entered or measured, so there is nothing estimated to check."}
        </p>
      )}

      {state.status === "running" && (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label="Robustness check progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
            className="h-2 overflow-hidden rounded-sm bg-panel-2"
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="text-xs text-fg-3" aria-live="polite">
            {state.progress
              ? `Stage ${state.progress.stage} of 2: ${state.progress.stage === 1 ? "screening every input" : "refining the most sensitive"} · ${Math.round(share * 100)}%`
              : "Starting…"}
          </p>
        </div>
      )}

      {state.status === "cancelled" && <p className="text-xs text-fg-3">Cancelled. Finished runs are kept, so checking again picks up where this stopped.</p>}
      {state.status === "error" && (
        <p role="alert" className="text-xs text-crit">
          The check failed: {state.error}
        </p>
      )}

      {state.status === "done" && verdict && (
        <>
          <p data-testid="robustness-verdict" className="rounded-token border border-line bg-panel-2 px-3 py-2 text-sm font-semibold">
            {verdict.verdict}
          </p>
          {verdict.conflicts.map((c) => (
            <p key={c} role="alert" data-testid="robustness-conflict" className="rounded-token border border-crit bg-crit-soft px-3 py-2 text-xs">
              {c}
            </p>
          ))}
          {verdict.details.map((d) => (
            <p key={d} className="text-xs text-fg-3">
              {d}
            </p>
          ))}
          <p className="text-xs text-fg-3">
            {state.fromCache
              ? "Shown from this session's earlier check; nothing was re-run."
              : `Checked in ${formatNumber((state.durationMs ?? 0) / 1000, 1)} s.`}
          </p>
          {verdict.sensitive.length > 0 && (
            <div>
              <h4 className="text-xs font-bold">Most sensitive inputs: measure these next</h4>
              <ol data-testid="robustness-sensitive" className="mt-1 flex flex-col gap-1 text-sm">
                {verdict.sensitive.map((s) => (
                  <li key={s.label} className="flex flex-wrap justify-between gap-x-3 border-b border-line/60 pb-1">
                    <span className={s.flips ? "font-semibold" : ""}>{s.label}</span>
                    <span className="text-xs tabular-nums text-fg-2">{s.effect}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-xs text-fg-3">Change in the gain from the scenario when the input is lower or higher.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
