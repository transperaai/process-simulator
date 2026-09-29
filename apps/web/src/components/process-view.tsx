"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModelError, toEngineModel, type ProcessBundle, type ScenarioRow } from "@transpera-flow/db";
import type { EngineModel } from "@transpera-flow/engine";
import { PASTE_OFFSET, copySteps, deleteSelection, duplicateSteps, pasteSteps, type StepClipboard } from "@/lib/editor/commands";
import type { Conflict, ProcessEditor } from "@/lib/editor/editor";
import { liveStore } from "@/lib/editor/live-store";
import type { Value } from "@/lib/editor/ops";
import { isProvenanceField } from "@/lib/editor/provenance";
import { MemoryStore } from "@/lib/editor/store";
import { useProcessEditor } from "@/lib/editor/use-editor";
import { useSimulation } from "@/lib/sim/use-simulation";
import { ConflictPrompt } from "./fields";
import { KpiStrip } from "./kpi-strip";
import { NO_SELECTION, ProcessCanvas, type CanvasCommands, type Selection } from "./process-canvas";
import { ScenarioPanel } from "./scenario-panel";
import { FIELD_LABELS, StepInspector } from "./step-inspector";
import { UtilisationBars } from "./utilisation-bars";

/**
 * How edits are saved: `live` to the database as the signed-in user, `demo`
 * in memory (lost on reload), `readonly` not at all (viewers).
 */
export type EditMode = "live" | "demo" | "readonly";

export function ProcessView({
  bundle: initial,
  mode,
  scenarios = [],
  userId = null,
}: {
  bundle: ProcessBundle;
  mode: EditMode;
  /** Saved scenarios of the workspace (in memory on the demo). */
  scenarios?: ScenarioRow[];
  /** The signed-in user, recorded as who entered the values they change. */
  userId?: string | null;
}) {
  const [state, editor] = useProcessEditor(
    initial,
    () => (mode === "live" ? liveStore(initial.revision.id) : new MemoryStore(initial)),
    () => ({ at: new Date().toISOString(), by: userId }),
  );
  const bundle = state.bundle;
  const editable = mode !== "readonly";
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);

  const resolved = useMemo(() => {
    try {
      return { model: toEngineModel(bundle), error: null };
    } catch (err) {
      if (err instanceof ModelError) return { model: null, error: err.message };
      throw err;
    }
  }, [bundle]);
  // Only a change to the model itself re-runs the simulation (moving a step doesn't).
  const modelKey = resolved.model ? JSON.stringify(resolved.model) : null;
  const model = useMemo(() => (modelKey ? (JSON.parse(modelKey) as EngineModel) : null), [modelKey]);
  // While an edit leaves the process unsimulatable, keep showing the last results.
  const [lastModel, setLastModel] = useState(model);
  if (model && model !== lastModel) setLastModel(model);
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;

  // Selection can outlive what it points at (after a delete or an undo).
  const selected = useMemo(() => {
    const steps = new Set(bundle.steps.map((s) => s.id));
    const edges = new Set(bundle.edges.map((e) => e.id));
    return { steps: selection.steps.filter((id) => steps.has(id)), edges: selection.edges.filter((id) => edges.has(id)) };
  }, [bundle, selection]);
  const inspected = selected.steps.length === 1 && !selected.edges.length ? bundle.steps.find((s) => s.id === selected.steps[0]) : undefined;

  // Copied steps, and how many times they've been pasted (each paste lands further along).
  const clipboard = useRef<{ clip: StepClipboard; pastes: number } | null>(null);
  // A step whose inspector should take focus once it shows ("Edit in the inspector").
  const [inspectFocus, setInspectFocus] = useState<string | null>(null);

  const commands = useMemo<CanvasCommands>(
    () => ({
      duplicate: (ids) => {
        let made: string[] = [];
        editor.run((b) => {
          const r = duplicateSteps(b, ids);
          made = r?.ids ?? [];
          return r?.edit ?? null;
        });
        if (made.length) setSelection({ steps: made, edges: [] });
      },
      copy: (ids) => {
        const clip = copySteps(editor.getState().bundle, ids);
        if (clip) clipboard.current = { clip, pastes: 0 };
      },
      remove: (ids) => {
        if (editor.run((b) => deleteSelection(b, ids, []))) setSelection(NO_SELECTION);
      },
      inspect: (id) => {
        setSelection({ steps: [id], edges: [] });
        setInspectFocus(id);
      },
    }),
    [editor],
  );

  useEffect(() => {
    if (!editable) return;
    const paste = () => {
      const held = clipboard.current;
      if (!held) return;
      const n = held.pastes + 1;
      let made: string[] = [];
      editor.run((b) => {
        const r = pasteSteps(b, held.clip, { x: PASTE_OFFSET * n, y: PASTE_OFFSET * n });
        made = r?.ids ?? [];
        return r?.edit ?? null;
      });
      if (!made.length) return;
      held.pastes = n;
      setSelection({ steps: made, edges: [] });
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      // Text fields keep their own undo, copy and delete keys.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Map keys work from the map (not its buttons or menu) or from nowhere in particular.
      const onMap = !target || target === document.body || (!!target.closest("[data-process-map]") && !target.closest("button, summary"));
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        editor.redo();
      } else if (!onMap) {
        return;
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        let { steps, edges } = selected;
        // Nothing selected: delete the step or connection that has focus.
        const focused = target?.closest(".react-flow__node, .react-flow__edge");
        const id = focused?.getAttribute("data-id");
        if (!steps.length && !edges.length && focused && id) {
          if (focused.classList.contains("react-flow__node")) steps = [id];
          else edges = [id];
        }
        if (editor.run((b) => deleteSelection(b, steps, edges))) {
          e.preventDefault();
          setSelection(NO_SELECTION);
          // What had focus is gone; keep it on the map.
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) document.querySelector<HTMLElement>("[data-process-map]")?.focus();
          });
        }
      } else if (mod && key === "c" && selected.steps.length && !window.getSelection()?.toString()) {
        e.preventDefault();
        commands.copy(selected.steps);
      } else if (mod && key === "v" && clipboard.current) {
        e.preventDefault();
        paste();
      } else if (mod && key === "d" && selected.steps.length) {
        e.preventDefault();
        commands.duplicate(selected.steps);
      } else if (mod && key === "a" && target?.closest("[data-process-map]")) {
        e.preventDefault();
        setSelection({ steps: bundle.steps.map((s) => s.id), edges: [] });
      } else if (e.key === "Escape" && target?.closest("[data-process-map]")) {
        setSelection(NO_SELECTION);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, editor, selected, commands, bundle.steps]);

  const shownModel = model ?? lastModel;

  return (
    <div className="flex flex-col gap-3">
      {shownModel ? (
        <KpiStrip
          model={shownModel}
          currency={bundle.workspace.settings.currency}
          result={result}
          status={sim.status}
          durationMs={sim.run?.durationMs}
        />
      ) : null}
      {resolved.error && (
        <p role="alert" className="rounded-token border border-crit bg-crit-soft p-3">
          This process can&apos;t be simulated yet: {resolved.error}.
          {shownModel && result ? " The figures above are from before this change." : ""}
        </p>
      )}
      {editable && <SaveProblems editor={editor} bundle={bundle} conflicts={state.conflicts} error={state.error} />}
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <ProcessCanvas
          bundle={bundle}
          result={result}
          editor={editable ? editor : null}
          editorState={editable ? state : null}
          selection={selected}
          onSelectionChange={setSelection}
          commands={editable ? commands : null}
        />
        {inspected && editable ? (
          <StepInspector
            key={inspected.id}
            bundle={bundle}
            step={inspected}
            editor={editor}
            autoFocus={inspectFocus === inspected.id}
            onFocused={() => setInspectFocus(null)}
            onClose={() => setSelection(NO_SELECTION)}
            onDelete={() => {
              editor.run((b) => deleteSelection(b, [inspected.id], []));
              setSelection(NO_SELECTION);
            }}
          />
        ) : shownModel ? (
          <UtilisationBars model={shownModel} result={result} />
        ) : null}
      </div>
      {shownModel && (
        <ScenarioPanel
          model={shownModel}
          baseline={sim.run}
          currency={bundle.workspace.settings.currency}
          workspaceId={bundle.workspace.id}
          initialScenarios={scenarios}
          mode={mode}
          steps={bundle.steps}
        />
      )}
    </div>
  );
}

/** Same-field conflicts waiting for "keep mine / keep theirs", and the last failed save. */
function SaveProblems({
  editor,
  bundle,
  conflicts,
  error,
}: {
  editor: ProcessEditor;
  bundle: ProcessBundle;
  conflicts: Conflict[];
  error: string | null;
}) {
  // A value's provenance is settled along with the value, so it gets no prompt of its own.
  conflicts = conflicts.filter((c) => !isProvenanceField(c.field));
  if (!conflicts.length && !error) return null;
  const names = new Map<string, string>([
    ...bundle.steps.map((s) => [s.id, s.name] as const),
    ...bundle.roles.map((r) => [r.id, r.name] as const),
    ...bundle.people.map((p) => [p.id, p.name] as const),
  ]);
  const show = (field: string, v: Value): string => {
    if (v === null || v === "") return "blank";
    if (typeof v === "object") return v.source;
    if (field === "probability" || field === "rework_rate") return `${Math.round(Number(v) * 1000) / 10}%`;
    if (field.endsWith("_id")) return names.get(String(v)) ?? "a removed item";
    return String(v);
  };
  const subject = (c: Conflict) => {
    const label = FIELD_LABELS[c.field] ?? c.field;
    if (c.table === "steps") return `${names.get(c.id) ?? "a step"}'s ${label}`;
    const edge = bundle.edges.find((e) => e.id === c.id);
    return edge ? `the ${label} of ${names.get(edge.from_step_id)} → ${names.get(edge.to_step_id)}` : `a connection's ${label}`;
  };
  return (
    <div className="flex flex-col gap-2">
      {conflicts.map((c) => (
        <ConflictPrompt
          key={`${c.table}:${c.id}:${c.field}`}
          subject={subject(c)}
          theirs={show(c.field, c.theirs)}
          mine={show(c.field, c.mine)}
          onKeepMine={() => void editor.keepMine(c)}
          onKeepTheirs={() => editor.keepTheirs(c)}
        />
      ))}
      {error && (
        <p role="alert" className="rounded-token border border-crit bg-crit-soft p-2 text-xs">
          {error}{" "}
          <button type="button" onClick={() => editor.dismissError()} className="underline">
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
