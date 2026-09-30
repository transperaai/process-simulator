"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelError, toEngineModel, type IssueRow, type ProcessBundle, type ScenarioRow, type SourceRow } from "@transpera-flow/db";
import type { EngineModel } from "@transpera-flow/engine";
import { discardChange, revertField } from "@/lib/drafts/discard";
import { EMPTY_DIFF, diffBundles, unresolvedSteps } from "@/lib/drafts/diff";
import { useDraftSession } from "@/lib/drafts/use-draft-session";
import { PASTE_OFFSET, copySteps, deleteSelection, duplicateSteps, pasteSteps, type StepClipboard } from "@/lib/editor/commands";
import { describeValue, fieldLabel, namesOf } from "@/lib/editor/describe";
import type { Conflict, ProcessEditor } from "@/lib/editor/editor";
import type { Table, Value } from "@/lib/editor/ops";
import { isProvenanceField } from "@/lib/editor/provenance";
import { connect } from "@/lib/realtime/connect";
import type { RealtimeSync } from "@/lib/realtime/sync";
import type { View, Viewer } from "@/lib/realtime/transport";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useSimulation } from "@/lib/sim/use-simulation";
import { ChangesPanel, DraftBar, DraftCompare, type DraftView } from "./draft-panels";
import { AssumptionChecklist } from "./evidence";
import { ConflictPrompt } from "./fields";
import { KpiStrip } from "./kpi-strip";
import { PresenceBar } from "./presence-bar";
import { NO_SELECTION, ProcessCanvas, type CanvasCommands, type Selection } from "./process-canvas";
import { useProcessIssues } from "./process-issues";
import { ScenarioPanel } from "./scenario-panel";
import { StepInspector } from "./step-inspector";
import { UtilisationBars } from "./utilisation-bars";

/**
 * How edits are saved: `live` to the database as the signed-in user, `demo`
 * in memory (lost on reload), `readonly` not at all (viewers). Either way
 * edits go into the process's draft, never the live revision (issue #9).
 */
export type EditMode = "live" | "demo" | "readonly";

/** Who you are on the public demo, where nobody signs in. */
const DEMO_VIEWER: Viewer = { userId: "demo-you", name: "You", email: null };

/** A bundle's engine model, the same object while the model is unchanged (moving a step doesn't change it). */
function useEngineModel(bundle: ProcessBundle): { model: EngineModel | null; error: string | null } {
  const resolved = useMemo(() => {
    try {
      return { model: toEngineModel(bundle), error: null };
    } catch (err) {
      if (err instanceof ModelError) return { model: null, error: err.message };
      throw err;
    }
  }, [bundle]);
  const modelKey = resolved.model ? JSON.stringify(resolved.model) : null;
  const model = useMemo(() => (modelKey ? (JSON.parse(modelKey) as EngineModel) : null), [modelKey]);
  return { model, error: resolved.error };
}

export function ProcessView({
  live: initialLive,
  draft: initialDraft,
  mode,
  scenarios = [],
  issues = [],
  initialFix = null,
  registerHref,
  userId = null,
  viewer = null,
  sources = [],
}: {
  live: ProcessBundle;
  draft: ProcessBundle | null;
  mode: EditMode;
  /** Saved scenarios of the workspace (in memory on the demo). */
  scenarios?: ScenarioRow[];
  /** Tracked issues of the workspace (in memory on the demo). */
  issues?: IssueRow[];
  /** An issue whose fix to run once the first run is in (`?fix=`). */
  initialFix?: string | null;
  /** The full issues register, if the workspace has one to link to. */
  registerHref?: string;
  /** The signed-in user, recorded as who entered the values they change. */
  userId?: string | null;
  /** The signed-in user as others see them in presence (issue #10). */
  viewer?: Viewer | null;
  /** The workspace's sources, which values cite as evidence (issue #21). */
  sources?: SourceRow[];
}) {
  const stamp = () => ({ at: new Date().toISOString(), by: userId });
  const sourcesHref = registerHref ? registerHref.replace(/\/issues$/, "/sources") : mode === "demo" ? "/demo/sources" : undefined;
  // Saves, catch-up reads and Realtime: the database and Supabase, or memory on the demo.
  const [connection] = useState(() => connect(mode, initialLive));
  const [session, drafts, state] = useDraftSession(
    initialLive,
    initialDraft,
    () => connection.backend,
    () => ({ at: new Date().toISOString(), by: userId }),
  );
  const editor = session.editor;
  const canEdit = mode !== "readonly";
  const hasDraft = drafts.draft !== null || drafts.opening;
  // Editors see the draft by default; everyone else the live model.
  const [view, setView] = useState<DraftView>(canEdit ? "draft" : "live");
  const showingLive = hasDraft && view === "live";
  const working = state.bundle;
  const live = drafts.live;
  const bundle = showingLive ? live : working;
  const editable = canEdit && !showingLive;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [compare, setCompare] = useState(false);
  const me = viewer ?? (mode === "demo" ? DEMO_VIEWER : null);
  const presenceView: View = hasDraft && !showingLive ? "draft" : "live";
  const [sync, realtime] = useRealtime(session, connection.transport, me, presenceView);

  const diff = useMemo(() => (hasDraft ? diffBundles(live, working) : EMPTY_DIFF), [hasDraft, live, working]);
  const names = useMemo(() => namesOf(working, live), [working, live]);

  const workingModel = useEngineModel(working);
  const liveModel = useEngineModel(live);
  const resolved = showingLive ? liveModel : workingModel;
  const model = resolved.model;
  // While an edit leaves the process unsimulatable, keep showing the last results.
  const [lastModel, setLastModel] = useState(workingModel.model);
  if (workingModel.model && workingModel.model !== lastModel) setLastModel(workingModel.model);
  // The draft (or, with no draft, live as the editor holds it) runs always; live runs too when shown or compared.
  const draftSim = useSimulation(workingModel.model);
  const liveSim = useSimulation(hasDraft && (showingLive || compare) ? liveModel.model : null);
  const sim = showingLive ? liveSim : draftSim;
  const result = sim.run?.result ?? null;

  const restore = useCallback(
    (table: Table, id: string) => {
      editor.run((b) => discardChange(session.getState().live, b, table, id));
    },
    [editor, session],
  );

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

  const shownModel = showingLive ? model : (model ?? lastModel);
  const unresolved = useMemo(() => unresolvedSteps(working), [working]);
  const blocked = state.saving
    ? "Wait for your edits to save."
    : state.conflicts.length
      ? "Settle the conflicting edits first (keep mine / keep theirs)."
      : workingModel.error
        ? `The draft can't be simulated: ${workingModel.error}.`
        : null;

  // Issues, levers and scenarios follow the model on screen (the draft, or live when shown).
  const issuesUi = useProcessIssues({
    bundle,
    model: shownModel,
    result,
    running: sim.status === "running",
    mode,
    initialIssues: issues,
    initialScenarios: scenarios,
    initialFix,
    registerHref,
  });

  const select = (table: Table, id: string) => {
    setView("draft");
    setSelection(table === "steps" ? { steps: [id], edges: [] } : { steps: [], edges: [id] });
  };

  return (
    <div className="flex flex-col gap-3">
      <PresenceBar
        sync={sync}
        state={realtime}
        me={me}
        processName={live.process.name}
        colleague={connection.colleague}
        selectedStep={selected.steps.length === 1 ? selected.steps[0]! : null}
      />
      <DraftBar
        session={session}
        drafts={drafts}
        canEdit={canEdit}
        view={showingLive ? "live" : "draft"}
        onView={(v) => {
          setView(v);
          setSelection(NO_SELECTION);
        }}
        changes={diff.list.length}
        blocked={blocked}
        unresolved={unresolved}
        compare={compare}
        onCompare={setCompare}
        onReview={(id) => select("steps", id)}
      />
      {compare && hasDraft && (
        <DraftCompare
          live={liveModel.model ? { model: liveModel.model, result: liveSim.run?.result ?? null } : null}
          draft={workingModel.model ? { model: workingModel.model, result: draftSim.run?.result ?? null } : null}
          currency={working.workspace.settings.currency}
          liveNumber={live.revision.number}
          draftNumber={drafts.draft?.number ?? live.revision.number + 1}
        />
      )}
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
      {editable && <SaveProblems editor={editor} bundle={bundle} conflicts={state.conflicts} error={state.error} sync={sync} />}
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <ProcessCanvas
          bundle={bundle}
          result={result}
          editor={editable ? editor : null}
          editorState={editable ? state : null}
          selection={selected}
          onSelectionChange={setSelection}
          commands={editable ? commands : null}
          diff={showingLive || !hasDraft ? null : diff}
          onRestore={editable ? restore : null}
          savedLabel={hasDraft ? "Saved to draft" : "Saved"}
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
            sources={sources}
            stamp={stamp}
            sourcesHref={sourcesHref}
            draft={
              hasDraft
                ? {
                    change: diff.steps.get(inspected.id),
                    names,
                    onRevert: (field) => editor.run((b) => revertField(session.getState().live, b, "steps", inspected.id, field)),
                    onDiscard: () => editor.run((b) => discardChange(session.getState().live, b, "steps", inspected.id)),
                  }
                : null
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {!showingLive && (
              <AssumptionChecklist
                bundle={working}
                editor={editable ? editor : null}
                sources={sources}
                stamp={stamp}
                onSelect={(id) => select("steps", id)}
              />
            )}
            {!showingLive && (
              <ChangesPanel diff={diff} live={live} bundle={working} editor={editable ? editor : null} names={names} onSelect={select} />
            )}
            {shownModel && issuesUi.rail(<UtilisationBars model={shownModel} result={result} />)}
          </div>
        )}
      </div>
      {issuesUi.badges}
      {shownModel && (
        <ScenarioPanel
          model={shownModel}
          baseline={sim.run}
          currency={bundle.workspace.settings.currency}
          workspaceId={bundle.workspace.id}
          initialScenarios={scenarios}
          mode={mode}
          fix={issuesUi.fix}
          onScenariosChange={issuesUi.onScenariosChange}
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
  sync,
}: {
  editor: ProcessEditor;
  bundle: ProcessBundle;
  conflicts: Conflict[];
  error: string | null;
  /** Names who made the other change, when their note has arrived. */
  sync: RealtimeSync | null;
}) {
  // A value's provenance is settled along with the value, so it gets no prompt of its own.
  conflicts = conflicts.filter((c) => !isProvenanceField(c.field));
  if (!conflicts.length && !error) return null;
  const names = namesOf(bundle);
  const show = (field: string, v: Value): string => describeValue(field, v, names);
  const subject = (c: Conflict) => {
    const label = fieldLabel(c.field);
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
          by={sync?.who(c.table, c.id, c.field, c.theirs) ?? null}
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
