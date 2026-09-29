"use client";

// Saved scenarios (docs/PRD.md §4.1): apply (and stack, in the order
// applied), duplicate and delete, and save the current levers as a new one.
// Anyone who can see the process can apply and compare; only editors save
// and delete (the database enforces it too).

import { useState, type FormEvent } from "react";
import type { ScenarioRow } from "@transpera-flow/db";
import type { EngineModel, PatchIssue } from "@transpera-flow/engine";
import { MAX_DESCRIPTION, MAX_NAME } from "@/lib/scenarios/validate";
import { describePatch } from "@/lib/scenarios/scenarios";

const buttonClass = "rounded-token border border-line px-2 py-0.5 text-xs hover:bg-panel-2 disabled:opacity-50";

function ScenarioItem({
  scenario,
  model,
  position,
  problems,
  canEdit,
  busy,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  scenario: ScenarioRow;
  model: EngineModel;
  /** 1-based place in the stack, or null when not applied. */
  position: number | null;
  problems: PatchIssue[];
  canEdit: boolean;
  busy: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const broken = problems.length > 0;
  return (
    <li
      data-scenario={scenario.name}
      className={`flex flex-col gap-1 rounded-token border px-2 py-1.5 ${position !== null ? "border-accent bg-accent-soft/60" : "border-line"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {position !== null && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs text-accent-fg" title="Order in the stack">
                {position}
              </span>
            )}
            {scenario.name}
            {broken && (
              <span className="rounded-token border border-crit bg-crit-soft px-1 text-xs font-normal" title={problems.map((p) => p.message).join(" ")}>
                Needs attention
              </span>
            )}
          </p>
          {scenario.description && <p className="text-xs text-fg-2">{scenario.description}</p>}
        </div>
        <button type="button" onClick={onToggle} disabled={broken && position === null} aria-pressed={position !== null} className={buttonClass}>
          {position !== null ? "Remove" : "Apply"}
        </button>
      </div>
      <ul className="text-xs text-fg-3">
        {scenario.patch.map((p, i) => (
          <li key={i}>{describePatch(model, p)}</li>
        ))}
      </ul>
      {broken && (
        <p className="text-xs text-crit" role="note">
          Left out of the comparison: {problems.map((p) => p.message).join(" ")}
        </p>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <button type="button" onClick={onDuplicate} disabled={busy} className={buttonClass}>
            Duplicate
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
                disabled={busy}
                className="rounded-token bg-crit px-2 py-0.5 text-xs font-semibold text-white"
              >
                Delete “{scenario.name}”
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={buttonClass}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={buttonClass}>
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ScenarioLibrary({
  scenarios,
  model,
  stack,
  problems,
  canEdit,
  leverCount,
  busy,
  error,
  onToggle,
  onClear,
  onSave,
  onDuplicate,
  onDelete,
}: {
  scenarios: ScenarioRow[];
  model: EngineModel;
  stack: string[];
  problems: Record<string, PatchIssue[]>;
  canEdit: boolean;
  /** Levers moved off neutral, which "Save" would store. */
  leverCount: number;
  busy: boolean;
  error: string | null;
  onToggle: (id: string) => void;
  onClear: () => void;
  onSave: (name: string, description: string) => Promise<boolean>;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onSave(name, description)) {
      setName("");
      setDescription("");
    }
  };
  return (
    <section aria-labelledby="scenarios-heading" className="flex flex-col gap-2 rounded-token border border-line bg-panel p-3 shadow-token">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="scenarios-heading" className="text-sm font-bold">
          Scenarios
        </h2>
        {stack.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-fg-2 underline">
            Remove all ({stack.length})
          </button>
        )}
      </div>
      <p className="text-xs text-fg-3">
        Apply one to compare it with today; apply more to stack them, in the order applied.
        {!canEdit && " You can apply and compare scenarios; editors can save and delete them."}
      </p>
      {error && (
        <p role="alert" className="rounded-token border border-crit bg-crit-soft px-2 py-1 text-xs">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {scenarios.map((s) => {
          const at = stack.indexOf(s.id);
          return (
            <ScenarioItem
              key={s.id}
              scenario={s}
              model={model}
              position={at >= 0 ? at + 1 : null}
              problems={problems[s.id] ?? []}
              canEdit={canEdit}
              busy={busy}
              onToggle={() => onToggle(s.id)}
              onDuplicate={() => onDuplicate(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          );
        })}
        {!scenarios.length && <li className="text-xs text-fg-3">No saved scenarios yet.</li>}
      </ul>
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-1.5 border-t border-line pt-2">
          <label htmlFor="scenario-name" className="text-xs font-medium text-fg-2">
            Save the levers as a scenario
          </label>
          <input
            id="scenario-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME}
            placeholder="e.g. Automate proposals"
            className="rounded-token border border-line bg-panel px-2 py-1 text-sm"
          />
          <textarea
            aria-label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRIPTION}
            rows={2}
            placeholder="What it stands for (optional)"
            className="rounded-token border border-line bg-panel px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !leverCount || !name.trim()}
            className="self-start rounded-token bg-accent px-3 py-1 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            Save {leverCount ? `${leverCount} lever change${leverCount === 1 ? "" : "s"}` : "levers"}
          </button>
          {!leverCount && <p className="text-xs text-fg-3">Move a lever first.</p>}
        </form>
      )}
    </section>
  );
}
