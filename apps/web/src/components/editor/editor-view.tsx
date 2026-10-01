"use client";

// The Editor (issue #104): editing a process on its own full-screen page, in the edit colour, not a mode of the map.
// A left column with the palette, the map in the middle, the inspector on the right, and "Compared with live" below
// after Simulate. Edits go to the process's single draft (D18); Publish makes it the next live version.
//
// The mode is a parameter (`draft`, `solution`, `block`): the hint and the save buttons change with it. Draft mode is
// built here; solutions (A49) and blocks (A51) plug into the same screen.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessBundle, ScenarioRow, SourceRow } from "@transpera-flow/db";
import { discardChange, revertField } from "@/lib/drafts/discard";
import { EMPTY_DIFF, diffBundles, unresolvedSteps } from "@/lib/drafts/diff";
import { useDraftSession } from "@/lib/drafts/use-draft-session";
import { namesOf } from "@/lib/editor/describe";
import type { Table } from "@/lib/editor/ops";
import { MODE_INFO, type EditorMode } from "@/lib/editor/modes";
import { connect } from "@/lib/realtime/connect";
import type { Viewer } from "@/lib/realtime/transport";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { newlyBroken, retiredSteps } from "@/lib/scenarios/broken";
import { useSimulation } from "@/lib/sim/use-simulation";
import type { EngineModel } from "@transpera-flow/engine";
import { NO_SELECTION, ProcessCanvas, type Selection } from "@/components/process-canvas";
import { PresenceBar } from "@/components/presence-bar";
import { SaveProblems, useEngineModel, type EditMode } from "@/components/process-view";
import { EditorBar } from "./editor-bar";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { SimulateFooter, type SimulatedPair } from "./simulate-footer";
import { useEditCommands } from "./use-edit-commands";

const DEMO_VIEWER: Viewer = { userId: "demo-you", name: "You", email: null };

export function EditorView({
  live: initialLive,
  draft: initialDraft,
  mode,
  editorMode = "draft",
  scenarios = [],
  sources = [],
  userId = null,
  viewer = null,
  sourcesHref,
  exitHref,
}: {
  live: ProcessBundle;
  draft: ProcessBundle | null;
  /** How edits are saved: to the database as the signed-in user, or in memory on the demo. Viewers can't open the Editor. */
  mode: Exclude<EditMode, "readonly">;
  /** What is being edited: a process's draft, a solution or a block. */
  editorMode?: EditorMode;
  /** Saved scenarios of the workspace, which publishing could break. */
  scenarios?: ScenarioRow[];
  /** Kept for the sources a step cites (issue #21). */
  sources?: SourceRow[];
  userId?: string | null;
  viewer?: Viewer | null;
  sourcesHref?: string;
  /** Where Exit editor goes. */
  exitHref: string;
}) {
  const router = useRouter();
  const stamp = useCallback(() => ({ at: new Date().toISOString(), by: userId }), [userId]);
  const [connection] = useState(() => connect(mode, initialLive));
  const [session, drafts, state] = useDraftSession(initialLive, initialDraft, () => connection.backend, () => ({ at: new Date().toISOString(), by: userId }));
  const editor = session.editor;
  const info = MODE_INFO[editorMode];
  const hasDraft = drafts.draft !== null || drafts.opening;
  const live = drafts.live;
  const working = state.bundle;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const me = viewer ?? (mode === "demo" ? DEMO_VIEWER : null);
  const [sync, realtime] = useRealtime(session, connection.transport, me, "draft");

  const diff = useMemo(() => (hasDraft ? diffBundles(live, working) : EMPTY_DIFF), [hasDraft, live, working]);
  const names = useMemo(() => namesOf(working, live), [working, live]);
  const workingModel = useEngineModel(working);
  const liveModel = useEngineModel(live);
  const unresolved = useMemo(() => unresolvedSteps(working), [working]);

  // Selection can outlive what it points at (after a delete or an undo).
  const selected = useMemo(() => {
    const steps = new Set(working.steps.map((s) => s.id));
    const edges = new Set(working.edges.map((e) => e.id));
    return { steps: selection.steps.filter((id) => steps.has(id)), edges: selection.edges.filter((id) => edges.has(id)) };
  }, [working, selection]);

  const { commands, inspectFocus, clearInspectFocus } = useEditCommands({ editor, bundle: working, selected, setSelection });
  const restore = useCallback(
    (table: Table, id: string) => {
      editor.run((b) => discardChange(session.getState().live, b, table, id));
    },
    [editor, session],
  );

  // ▶ Simulate: both versions run 30 times, on the models as they were when it was pressed.
  const [asked, setAsked] = useState<{ draft: EngineModel; live: EngineModel | null } | null>(null);
  const draftSim = useSimulation(asked?.draft ?? null);
  const liveSim = useSimulation(asked?.live ?? null);
  const simulating = !!asked && (draftSim.status === "running" || (!!asked.live && liveSim.status === "running"));
  const failed = draftSim.status === "error" ? draftSim.error : liveSim.status === "error" && asked?.live ? liveSim.error : null;
  const pair: SimulatedPair | null = asked
    ? {
        draft: { model: asked.draft, result: draftSim.status === "done" ? draftSim.run.result : null },
        live: asked.live ? { model: asked.live, result: liveSim.status === "done" ? liveSim.run.result : null } : null,
      }
    : null;
  const stale = !!asked && !!workingModel.model && JSON.stringify(workingModel.model) !== JSON.stringify(asked.draft);

  const breaks = useMemo(
    () =>
      hasDraft && liveModel.model && workingModel.model
        ? newlyBroken(liveModel.model, workingModel.model, scenarios, retiredSteps(working, live))
        : [],
    [hasDraft, liveModel.model, workingModel.model, scenarios, working, live],
  );
  const blocked = state.saving
    ? "Wait for your edits to save."
    : state.conflicts.length
      ? "Settle the conflicting edits first (keep mine / keep theirs)."
      : workingModel.error
        ? `The draft can't be simulated: ${workingModel.error}.`
        : null;

  const simulate = () => {
    if (workingModel.model) setAsked({ draft: workingModel.model, live: liveModel.model });
  };
  const select = (id: string) => setSelection({ steps: [id], edges: [] });

  return (
    <div data-editor={editorMode} className="flex min-h-svh flex-col bg-bg text-fg lg:h-svh">
      <EditorBar
        mode={editorMode}
        subject={live.process.name}
        session={session}
        drafts={drafts}
        changes={diff.list.length}
        saving={state.saving}
        blocked={blocked}
        unresolved={unresolved}
        breaks={breaks}
        simulating={simulating}
        onSimulate={simulate}
        onReview={select}
        exitHref={exitHref}
        // The demo lives in this tab, so it stays here to be looked at; a workspace goes back to the map, now live.
        onPublished={() => mode !== "demo" && router.push(exitHref)}
        canSave={info.available}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
        <aside aria-label="Palette" className="flex flex-col gap-4 border-b border-line bg-panel p-3.5 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <Palette bundle={working} editor={editor} selected={selected} setSelection={setSelection} />
          {mode === "demo" && (
            <p role="note" className="text-xs text-muted-foreground">
              Demo: your edits live in this tab only. Leaving the Editor or reloading starts the sample again.
            </p>
          )}
          <div className="mt-auto flex flex-col gap-2 empty:hidden">
            <PresenceBar
              variant="compact"
              sync={sync}
              state={realtime}
              me={me}
              processName={live.process.name}
              colleague={connection.colleague}
              selectedStep={selected.steps.length === 1 ? selected.steps[0]! : null}
            />
          </div>
        </aside>
        <main className="flex min-h-[28rem] min-w-0 flex-col gap-2 bg-bg p-3 lg:min-h-0">
          {(state.conflicts.length > 0 || state.error) && <SaveProblems editor={editor} bundle={working} conflicts={state.conflicts} error={state.error} sync={sync} />}
          {workingModel.error && (
            <p role="status" className="rounded-token border border-warn bg-warn-soft px-2 py-1.5 text-xs">
              This draft can&apos;t be simulated yet: {workingModel.error}.
            </p>
          )}
          <div className="flex min-h-0 flex-1">
            <ProcessCanvas
              bundle={working}
              result={!stale && pair?.draft.result ? pair.draft.result : null}
              editor={editor}
              editorState={state}
              selection={selected}
              onSelectionChange={setSelection}
              commands={commands}
              diff={hasDraft ? diff : null}
              onRestore={restore}
              savedLabel={hasDraft ? "Saved to draft" : "Saved"}
              hideAdd
            />
          </div>
        </main>
        <aside aria-label="Inspector" className="flex flex-col gap-4 border-t border-line bg-panel p-3.5 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <Inspector
            bundle={working}
            editor={editor}
            selected={selected}
            setSelection={setSelection}
            inspectFocus={inspectFocus}
            onFocused={clearInspectFocus}
            sources={sources}
            stamp={stamp}
            sourcesHref={sourcesHref}
            mode={editorMode}
            draft={
              hasDraft
                ? (step) => ({
                    change: diff.steps.get(step.id),
                    names,
                    onRevert: (field) => editor.run((b) => revertField(session.getState().live, b, "steps", step.id, field)),
                    onDiscard: () => editor.run((b) => discardChange(session.getState().live, b, "steps", step.id)),
                  })
                : null
            }
          />
        </aside>
      </div>
      <SimulateFooter
        asked={!!asked}
        pair={pair}
        failed={failed}
        stale={stale}
        currency={working.workspace.settings.currency}
        liveNumber={live.revision.number}
      />
    </div>
  );
}
