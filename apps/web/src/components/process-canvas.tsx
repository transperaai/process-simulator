"use client";

// The process map (PRD §8.1): custom step nodes (role stripe, queue count,
// bottleneck ring, selection ring, branch warning) and branch edges. With an
// editor it is editable (issue #8): drag to move, drag handle to handle to
// connect, drag an edge end to reroute, click an edge to set its probability
// and condition tag, double-click empty canvas or use the toolbar to add a
// step. Every change goes through the editor, so it is undoable and saved.

import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import type { SimulationResult } from "@transpera-flow/engine";
import type { PersonRow, ProcessBundle, RoleRow, StepOutcome, StepRow } from "@transpera-flow/db";
import {
  KIND_LABELS,
  OUTCOME_LABELS,
  STEP_KINDS,
  addEdge,
  addStep,
  connectionProblem,
  deleteEdges,
  moveSteps,
  nextOutcome,
  reconnectEdge,
  stepWarnings,
  updateEdge,
  type NewStepKind,
} from "@/lib/editor/commands";
import type { EditorState, ProcessEditor } from "@/lib/editor/editor";
import { formatHours, formatNumber } from "@/lib/format";

/** What is selected on the canvas. Arrays so multi-select can slot in later. */
export interface Selection {
  steps: string[];
  edges: string[];
}

export const NO_SELECTION: Selection = { steps: [], edges: [] };

type StepNodeData = {
  step: StepRow;
  role: RoleRow | null;
  person: PersonRow | null;
  avgQueue: number | null;
  bottleneck: boolean;
  warning: string | null;
  editable: boolean;
};

type StepFlowNode = Node<StepNodeData, "step">;
type TerminalFlowNode = Node<StepNodeData, "terminal">;
type BranchData = { probability: number; tag: string | null };
type BranchFlowEdge = Edge<BranchData, "branch">;

/** Lets the custom edge reach the editor without threading it through React Flow's data. */
const CanvasContext = createContext<{ editor: ProcessEditor | null }>({ editor: null });

const handleClass = (editable: boolean) =>
  editable ? "!size-2.5 !border-2 !border-panel !bg-fg-3 hover:!bg-accent" : "!bg-line-2";

function Warning({ text }: { text: string }) {
  return (
    <span
      role="img"
      aria-label={`Warning: ${text}`}
      title={text}
      className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full border-2 border-panel bg-warn text-[11px] font-bold text-fg"
    >
      !
    </span>
  );
}

const selectedRing = "outline-2 outline-offset-2 outline-accent";

function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { step, role, person, avgQueue, bottleneck, warning, editable } = data;
  const who = person?.name ?? role?.name;
  const label = [
    step.name,
    who,
    `${formatHours(step.work_hours)} work`,
    `${formatHours(step.wait_hours)} wait`,
    warning && `warning: ${warning}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      aria-label={label}
      className={`relative w-44 rounded-token border bg-panel shadow-token ${bottleneck ? "border-crit ring-2 ring-crit/40" : "border-line-2"} ${selected ? selectedRing : ""}`}
    >
      <Handle type="target" position={Position.Left} className={handleClass(editable)} />
      <div className="h-1 rounded-t-token" style={{ background: role?.color ?? "var(--line-2)" }} />
      <div className="px-2.5 py-2">
        <p className="font-semibold leading-tight">{step.name}</p>
        <p className="text-xs text-fg-2">
          {who ?? (step.kind === "decision" ? "Decision" : step.kind === "wait" ? "Wait" : "No role")}
          {person && <span className="text-fg-3"> · pinned</span>}
        </p>
        <p className="mt-1 flex justify-between font-mono text-[11px] text-fg-3 tabular-nums">
          <span>{Number(step.work_hours) ? `${formatHours(step.work_hours)} work` : "—"}</span>
          <span>{Number(step.wait_hours) ? `${formatHours(step.wait_hours)} wait` : ""}</span>
        </p>
        {avgQueue !== null && (role || person) && (
          <p className={`mt-1 text-xs tabular-nums ${bottleneck ? "font-semibold text-crit" : "text-fg-2"}`}>
            avg queue {formatNumber(avgQueue)}
          </p>
        )}
      </div>
      {warning && <Warning text={warning} />}
      <Handle type="source" position={Position.Right} className={handleClass(editable)} />
    </div>
  );
}

function TerminalNode({ data, selected }: NodeProps<TerminalFlowNode>) {
  const { step, warning, editable } = data;
  const tone =
    step.outcome === "won" ? "bg-good-soft text-fg" : step.outcome === "lost" ? "bg-panel-2 text-fg-2" : "bg-accent-soft text-fg";
  return (
    <div
      aria-label={[step.name, step.kind === "start" ? "start" : `end, ${step.outcome}`, warning && `warning: ${warning}`].filter(Boolean).join(", ")}
      className={`relative rounded-full border border-line-2 px-3 py-1.5 text-xs font-semibold ${tone} ${selected ? selectedRing : ""}`}
    >
      {step.kind !== "start" && <Handle type="target" position={Position.Left} className={handleClass(editable)} />}
      {step.name}
      {warning && <Warning text={warning} />}
      {step.kind === "start" && <Handle type="source" position={Position.Right} className={handleClass(editable)} />}
    </div>
  );
}

const percent = (p: number) => `${Math.round(p * 1000) / 10}%`;

/** A branch: its probability (and condition tag) as a label, edited inline when selected. */
function BranchEdge(props: EdgeProps<BranchFlowEdge>) {
  const { id, data, selected, markerEnd, style } = props;
  const { editor } = useContext(CanvasContext);
  const zoom = useStore((s) => s.transform[2]);
  const [path, labelX, labelY] = getSmoothStepPath(props);
  const p = data?.probability ?? 1;
  const tag = data?.tag ?? null;
  const editing = selected && editor;
  const text = [p < 1 ? percent(p) : null, tag].filter(Boolean).join(" · ");
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18} />
      {(editing || text) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              // The editor stays readable at any zoom and sits above the nodes.
              transform: `translate(${labelX}px, ${labelY}px) ${editing ? `scale(${1 / zoom})` : ""} translate(-50%, -50%)`,
              transformOrigin: "0 0",
              zIndex: editing ? 1002 : undefined,
              pointerEvents: "all",
            }}
          >
            {editing ? (
              <BranchEditor key={id} editor={editor} edgeId={id} probability={p} tag={tag} />
            ) : (
              <span className="rounded-token bg-panel px-1 font-mono text-[11px] text-fg-2 tabular-nums">{text}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeInputClass = "rounded-token border border-line bg-panel px-1.5 py-0.5 tabular-nums";

function BranchEditor({ editor, edgeId, probability, tag }: { editor: ProcessEditor; edgeId: string; probability: number; tag: string | null }) {
  const shown = String(Math.round(probability * 1000) / 10);
  const [pct, setPct] = useState(shown);
  const [tagText, setTagText] = useState(tag ?? "");
  // Take the stored values when they change (a save, an undo). Remounting
  // instead would steal focus from the other input mid-edit.
  const [seen, setSeen] = useState({ shown, tag });
  if (seen.shown !== shown || seen.tag !== tag) {
    setSeen({ shown, tag });
    setPct(shown);
    setTagText(tag ?? "");
  }
  const [error, setError] = useState<string | null>(null);
  const commitPct = () => {
    const v = Number(pct.trim());
    if (pct.trim() === "" || !Number.isFinite(v) || v < 0 || v > 100) {
      setError("Enter 0–100%.");
      return;
    }
    setError(null);
    editor.run((b) => updateEdge(b, edgeId, { probability: Math.round(v * 10) / 1000 }));
  };
  const commitTag = () => editor.run((b) => updateEdge(b, edgeId, { condition_tag: tagText.trim() || null }));
  const keys = (commit: () => void, revert: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") revert();
  };
  return (
    <div className="flex flex-col gap-1 rounded-token border border-accent bg-panel p-1.5 text-xs shadow-token">
      <label className="flex items-center gap-1">
        <span className="w-9 text-fg-2">Share</span>
        <input
          aria-label="Branch probability, percent"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          onBlur={commitPct}
          onKeyDown={keys(commitPct, () => setPct(shown))}
          className={`${edgeInputClass} w-16`}
        />
        <span className="text-fg-3">%</span>
      </label>
      <label className="flex items-center gap-1">
        <span className="w-9 text-fg-2">Tag</span>
        <input
          aria-label="Condition tag"
          value={tagText}
          maxLength={100}
          placeholder="none"
          onChange={(e) => setTagText(e.target.value)}
          onBlur={commitTag}
          onKeyDown={keys(commitTag, () => setTagText(tag ?? ""))}
          className={`${edgeInputClass} w-24`}
        />
      </label>
      {error && (
        <p role="alert" className="text-crit">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => editor.run((b) => deleteEdges(b, [edgeId]))}
        className="self-start text-crit hover:underline"
      >
        Remove connection
      </button>
    </div>
  );
}

const nodeTypes = { step: StepNode, terminal: TerminalNode };
const edgeTypes = { branch: BranchEdge };

interface CanvasProps {
  bundle: ProcessBundle;
  result: SimulationResult | null;
  /** Null for a read-only canvas. */
  editor: ProcessEditor | null;
  editorState: EditorState | null;
  selection: Selection;
  onSelectionChange: Dispatch<SetStateAction<Selection>>;
}

export function ProcessCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ bundle, result, editor, editorState, selection, onSelectionChange }: CanvasProps) {
  const editable = editor !== null;
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  // Positions of nodes mid-drag, and sizes React Flow measured; the rest comes from the bundle.
  const [dragging, setDragging] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());

  const warnings = useMemo(() => (editable ? stepWarnings(bundle) : new Map<string, string>()), [bundle, editable]);

  const nodes = useMemo(() => {
    const roles = new Map(bundle.roles.map((r) => [r.id, r]));
    const people = new Map(bundle.people.map((p) => [p.id, p]));
    const selected = new Set(selection.steps);
    return bundle.steps.map((step): StepFlowNode | TerminalFlowNode => ({
      id: step.id,
      type: step.kind === "start" || step.kind === "end" ? "terminal" : "step",
      position: dragging.get(step.id) ?? { x: Number(step.x), y: Number(step.y) },
      selected: selected.has(step.id),
      ...(measured.has(step.id) ? { measured: measured.get(step.id) } : {}),
      data: {
        step,
        role: step.role_id ? (roles.get(step.role_id) ?? null) : null,
        person: step.person_id ? (people.get(step.person_id) ?? null) : null,
        avgQueue: result?.steps[step.id]?.avgQueue ?? null,
        bottleneck: result?.bnStep === step.id,
        warning: warnings.get(step.id) ?? null,
        editable,
      },
    }));
  }, [bundle, result, selection.steps, dragging, measured, warnings, editable]);

  const edges = useMemo(() => {
    const selected = new Set(selection.edges);
    const names = new Map(bundle.steps.map((s) => [s.id, s.name]));
    return bundle.edges.map(
      (e): BranchFlowEdge => ({
        id: e.id,
        source: e.from_step_id,
        target: e.to_step_id,
        type: "branch",
        selected: selected.has(e.id),
        data: { probability: Number(e.probability), tag: e.condition_tag },
        style: { stroke: selected.has(e.id) ? "var(--accent)" : "var(--line-2)", strokeWidth: selected.has(e.id) ? 2.5 : 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: selected.has(e.id) ? "var(--accent)" : "var(--line-2)" },
        ariaLabel: `${names.get(e.from_step_id)} to ${names.get(e.to_step_id)}, ${percent(Number(e.probability))}${e.condition_tag ? `, tag ${e.condition_tag}` : ""}`,
      }),
    );
  }, [bundle, selection.edges]);

  const onNodesChange = (changes: NodeChange<StepFlowNode | TerminalFlowNode>[]) => {
    const moves: { id: string; x: number; y: number }[] = [];
    const drags = new Map(dragging);
    const sizes = new Map(measured);
    let moved = false;
    let sized = false;
    const picks: { id: string; selected: boolean }[] = [];
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        sizes.set(c.id, c.dimensions);
        sized = true;
      } else if (c.type === "position" && c.position) {
        // Drag end and arrow keys arrive with dragging false: that is the move to save.
        if (c.dragging) drags.set(c.id, c.position);
        else {
          moves.push({ id: c.id, ...c.position });
          drags.delete(c.id);
        }
        moved = true;
      } else if (c.type === "select") picks.push({ id: c.id, selected: c.selected });
    }
    if (sized) setMeasured(sizes);
    if (moves.length) editor?.run((b) => moveSteps(b, moves));
    if (moved) setDragging(drags);
    if (picks.length) onSelectionChange((s) => ({ ...s, steps: applyPicks(s.steps, picks) }));
  };

  const onEdgesChange = (changes: EdgeChange<BranchFlowEdge>[]) => {
    const picks = changes.flatMap((c) => (c.type === "select" ? [{ id: c.id, selected: c.selected }] : []));
    if (picks.length) onSelectionChange((s) => ({ ...s, edges: applyPicks(s.edges, picks) }));
  };

  const onConnect = (c: Connection) => {
    let id: string | null = null;
    editor?.run((b) => {
      const made = addEdge(b, c.source, c.target);
      id = made?.id ?? null;
      return made?.edit ?? null;
    });
    if (id) onSelectionChange({ steps: [], edges: [id] });
  };

  /** Add a step centred on a point on screen, nudged down off any step already there. */
  const addAt = (kind: NewStepKind, outcome: StepOutcome | null, screen: { x: number; y: number }) => {
    const p = flow.screenToFlowPosition(screen);
    const x = p.x - 88;
    let y = p.y - 30;
    // Roughly a step card's size, so a new step doesn't land on top of another.
    const taken = (x0: number, y0: number) =>
      bundle.steps.some((s) => Math.abs(Number(s.x) - x0) < 180 && Math.abs(Number(s.y) - y0) < 90);
    for (let i = 0; i < 12 && taken(x, y); i++) y += 45;
    let id: string | null = null;
    editor?.run((b) => {
      const made = addStep(b, { kind, outcome, x, y });
      id = made.id;
      return made.edit;
    });
    if (id) onSelectionChange({ steps: [id], edges: [] });
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (!editable || !(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) return;
    addAt("task", null, { x: e.clientX, y: e.clientY });
  };

  const addFromToolbar = (kind: NewStepKind, outcome: StepOutcome | null) => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    addAt(kind, outcome, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  return (
    <CanvasContext.Provider value={{ editor }}>
      <div
        ref={wrapper}
        onDoubleClick={onDoubleClick}
        className="h-[28rem] w-full rounded-token border border-line bg-panel md:h-[34rem]"
        aria-label={`${bundle.process.name} process map`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={editable ? onConnect : undefined}
          isValidConnection={(c) => !connectionProblem(bundle, c.source, c.target)}
          onReconnect={editable ? (old, c) => editor.run((b) => reconnectEdge(b, old.id, c.source, c.target)) : undefined}
          edgesReconnectable={editable}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={editable}
          edgesFocusable={editable}
          // Deleting goes through the editor (see ProcessView), never React Flow's own delete.
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--line)" gap={24} />
          {editable && editorState && (
            <Panel position="top-left">
              <Toolbar bundle={bundle} editor={editor} state={editorState} onAdd={addFromToolbar} />
            </Panel>
          )}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

function applyPicks(ids: string[], picks: { id: string; selected: boolean }[]): string[] {
  const set = new Set(ids);
  for (const p of picks) {
    if (p.selected) set.add(p.id);
    else set.delete(p.id);
  }
  return set.size === ids.length && ids.every((id) => set.has(id)) ? ids : [...set];
}

const toolButton =
  "rounded-token border border-line bg-panel px-2 py-1 text-fg hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-fg-3 disabled:hover:bg-panel";

/** Add a step, undo, redo, and whether edits are saved. */
function Toolbar({
  bundle,
  editor,
  state,
  onAdd,
}: {
  bundle: ProcessBundle;
  editor: ProcessEditor;
  state: EditorState;
  onAdd: (kind: NewStepKind, outcome: StepOutcome | null) => void;
}) {
  const [kind, setKind] = useState<NewStepKind>("task");
  const [outcome, setOutcome] = useState<StepOutcome | "">("");
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";
  return (
    <div
      role="toolbar"
      aria-label="Edit the process"
      className="flex flex-wrap items-center gap-1.5 rounded-token border border-line bg-panel/95 p-1.5 text-xs shadow-token"
    >
      <label className="sr-only" htmlFor="new-step-kind">
        Kind of step to add
      </label>
      <select
        id="new-step-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as NewStepKind)}
        className="rounded-token border border-line bg-panel px-1.5 py-1"
      >
        {STEP_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {kind === "end" && (
        <>
          <label className="sr-only" htmlFor="new-step-outcome">
            Outcome of the end step
          </label>
          <select
            id="new-step-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as StepOutcome | "")}
            className="rounded-token border border-line bg-panel px-1.5 py-1"
          >
            <option value="">{OUTCOME_LABELS[nextOutcome(bundle)]} (next free)</option>
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        type="button"
        onClick={() => onAdd(kind, kind === "end" ? outcome || null : null)}
        className="rounded-token bg-accent px-2 py-1 font-semibold text-accent-fg"
      >
        Add step
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
      <button
        type="button"
        onClick={() => editor.undo()}
        disabled={!state.undoLabel}
        title={state.undoLabel ? `Undo: ${state.undoLabel} (${mod}Z)` : "Nothing to undo"}
        className={toolButton}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={() => editor.redo()}
        disabled={!state.redoLabel}
        title={state.redoLabel ? `Redo: ${state.redoLabel} (${mac ? "⇧⌘Z" : "Ctrl+Y"})` : "Nothing to redo"}
        className={toolButton}
      >
        Redo
      </button>
      <span className="px-1 text-fg-3" aria-live="polite">
        {state.saving ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}
