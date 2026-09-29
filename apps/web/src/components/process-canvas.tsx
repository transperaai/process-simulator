"use client";

// The process map (PRD §8.1): custom step nodes (role stripe, queue count,
// bottleneck ring, selection ring, branch warning) and branch edges. With an
// editor it is editable (issue #8): drag to move, drag handle to handle to
// connect, drag an edge end to reroute, click an edge to set its probability
// and condition tag, double-click empty canvas or use the toolbar to add a
// step. Double-click a step (or focus it and press Enter or F2) to edit it in
// place; right-click it (or Shift+F10) for its menu. Shift-click and
// Shift-drag select several steps. The swimlane view groups steps by role.
// Every change goes through the editor, so it is undoable and saved.

import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type AriaLabelConfig,
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
  useCallback,
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
import type { InlineField } from "@/lib/editor/inline-edit";
import { laneLayout, type Lane } from "@/lib/editor/lanes";
import { formatHours, formatNumber } from "@/lib/format";
import { usePlayback } from "@/lib/playback/use-playback";
import { InlineEditContext, NodeInlineEditor, type InlineEditing } from "./node-inline-editor";
import { PlaybackBar } from "./playback-bar";
import { PlaybackLayer } from "./playback-layer";
import { NodeMenu, type CanvasCommands, type MenuState } from "./node-menu";

export type { CanvasCommands } from "./node-menu";

/** What is selected on the canvas. */
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
  /** Name of the step its rework goes back to, if not itself. */
  reworkTo: string | null;
  /** The field to focus while the card is being edited in place; null when it isn't. */
  editing: InlineField | null;
  /** The bottleneck, while playback plays. */
  pulse: boolean;
};

type StepFlowNode = Node<StepNodeData, "step">;
type TerminalFlowNode = Node<StepNodeData, "terminal">;
type FlowNode = StepFlowNode | TerminalFlowNode;

/** Whether two node objects for a step would draw the same. */
function sameNode(a: FlowNode, b: FlowNode): boolean {
  if (a.type !== b.type || a.selected !== b.selected || a.ariaLabel !== b.ariaLabel || a.zIndex !== b.zIndex) return false;
  if (a.position.x !== b.position.x || a.position.y !== b.position.y) return false;
  if (a.measured?.width !== b.measured?.width || a.measured?.height !== b.measured?.height) return false;
  return (Object.keys(a.data) as (keyof StepNodeData)[]).every((k) => a.data[k] === b.data[k]);
}

/** `alone`: it is the only thing selected, so its inline editor shows. */
type BranchData = { probability: number; tag: string | null; alone: boolean };
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

const percent = (p: number) => `${Math.round(p * 1000) / 10}%`;

/** What a screen reader hears for a step. */
function stepLabel({ step, role, person, warning, reworkTo }: StepNodeData): string {
  if (step.kind === "start" || step.kind === "end") {
    return [step.name, step.kind === "start" ? "start" : `end, ${step.outcome}`, warning && `warning: ${warning}`].filter(Boolean).join(", ");
  }
  return [
    step.name,
    step.kind !== "task" && KIND_LABELS[step.kind].toLowerCase(),
    person ? `pinned to ${person.name}` : role?.name,
    `${formatHours(step.work_hours)} work`,
    `${formatHours(step.wait_hours)} wait`,
    reworkTo && `${percent(Number(step.rework_rate))} rework back to ${reworkTo}`,
    warning && `warning: ${warning}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { step, role, person, avgQueue, bottleneck, warning, editable, reworkTo, editing, pulse } = data;
  const who = person?.name ?? role?.name;
  return (
    <div
      className={`relative rounded-token border bg-panel shadow-token ${editing ? "w-60 border-accent" : "w-44"} ${bottleneck && !editing ? "border-crit ring-2 ring-crit/40" : editing ? "" : "border-line-2"} ${selected ? selectedRing : ""}`}
    >
      {pulse && !editing && (
        <span aria-hidden className="bottleneck-pulse pointer-events-none absolute -inset-1.5 rounded-token border-2 border-crit" />
      )}
      <Handle type="target" position={Position.Left} className={handleClass(editable)} />
      <div className="h-1 rounded-t-token" style={{ background: role?.color ?? "var(--line-2)" }} />
      {editing ? (
        <NodeInlineEditor step={step} focus={editing} />
      ) : (
        <div className="px-2.5 py-2">
          <p data-field="name" className="font-semibold leading-tight">
            {step.name}
          </p>
          <p data-field={person ? "person_id" : "role_id"} className="text-xs text-fg-2">
            {who ?? (step.kind === "decision" ? "Decision" : step.kind === "wait" ? "Wait" : "No role")}
            {person && <span className="text-fg-3"> · pinned</span>}
          </p>
          <p className="mt-1 flex justify-between font-mono text-[11px] text-fg-3 tabular-nums">
            <span data-field="work_hours">{Number(step.work_hours) ? `${formatHours(step.work_hours)} work` : "—"}</span>
            <span data-field="wait_hours">{Number(step.wait_hours) ? `${formatHours(step.wait_hours)} wait` : ""}</span>
          </p>
          {reworkTo && Number(step.rework_rate) > 0 && (
            <p className="mt-0.5 truncate text-[11px] text-fg-3" title={`Rework goes back to ${reworkTo}`}>
              ↺ {percent(Number(step.rework_rate))} back to {reworkTo}
            </p>
          )}
          {avgQueue !== null && (role || person) && (
            <p className={`mt-1 text-xs tabular-nums ${bottleneck ? "font-semibold text-crit" : "text-fg-2"}`}>
              avg queue {formatNumber(avgQueue)}
            </p>
          )}
        </div>
      )}
      {warning && <Warning text={warning} />}
      <Handle type="source" position={Position.Right} className={handleClass(editable)} />
    </div>
  );
}

function TerminalNode({ data, selected }: NodeProps<TerminalFlowNode>) {
  const { step, warning, editable, editing } = data;
  const tone =
    step.outcome === "won" ? "bg-good-soft text-fg" : step.outcome === "lost" ? "bg-panel-2 text-fg-2" : "bg-accent-soft text-fg";
  return (
    <div
      className={`relative border text-xs font-semibold ${editing ? "w-44 rounded-token border-accent bg-panel" : `rounded-full border-line-2 px-3 py-1.5 ${tone}`} ${selected ? selectedRing : ""}`}
    >
      {step.kind !== "start" && <Handle type="target" position={Position.Left} className={handleClass(editable)} />}
      {editing ? <NodeInlineEditor step={step} focus="name" /> : <span data-field="name">{step.name}</span>}
      {warning && <Warning text={warning} />}
      {step.kind === "start" && <Handle type="source" position={Position.Right} className={handleClass(editable)} />}
    </div>
  );
}

/** A branch: its probability (and condition tag) as a label, edited inline when selected. */
function BranchEdge(props: EdgeProps<BranchFlowEdge>) {
  const { id, data, selected, markerEnd, style } = props;
  const { editor } = useContext(CanvasContext);
  const zoom = useStore((s) => s.transform[2]);
  const [path, labelX, labelY] = getSmoothStepPath(props);
  const p = data?.probability ?? 1;
  const tag = data?.tag ?? null;
  const editing = selected && data?.alone && editor;
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

/** Put focus back on an edge of the map. */
const focusEdge = (id: string) => document.querySelector<SVGGElement>(`.react-flow__edge[data-id="${id}"]`)?.focus();

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
  // Set by Escape, so the blur that follows doesn't save the draft being dropped.
  const dropping = useRef(false);
  const onBlur = (commit: () => void) => () => {
    if (!dropping.current) commit();
  };
  const keys = (commit: () => void, revert: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      // Drop the draft and go back to the connection itself.
      e.preventDefault();
      revert();
      setError(null);
      // Moving focus blurs the input at once; the flag only covers that blur.
      dropping.current = true;
      focusEdge(edgeId);
      dropping.current = false;
    }
  };
  return (
    <div
      data-edge-editor={edgeId}
      role="group"
      aria-label="Edit connection"
      // React events bubble through the portal to the edge, whose own key handling (Escape blurs
      // and unselects it) is for the edge itself, not for typing here.
      onKeyDown={(e) => e.stopPropagation()}
      className="flex flex-col gap-1 rounded-token border border-accent bg-panel p-1.5 text-xs shadow-token"
    >
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
          onBlur={onBlur(commitPct)}
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
          onBlur={onBlur(commitTag)}
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

/** Room around the steps when framing them: the toolbar sits top left, playback along the foot, lane names on the left. */
const fitPadding = (lanes: boolean) => ({ top: "64px", right: "24px", bottom: "72px", left: lanes ? "150px" : "24px" }) as const;

const EDIT_ARIA: Partial<AriaLabelConfig> = {
  "node.a11yDescription.default":
    "Enter or F2 edits the step here; Shift+F10 opens its actions; Space selects it (Shift+Space adds it to the selection). When selected, arrow keys move it, Delete removes it and Escape clears the selection.",
  "edge.a11yDescription.default":
    "Enter edits its share and condition tag; Space selects it. Delete removes it and Escape clears the selection.",
};

/**
 * Tab order for the map: the order a lead flows through it (breadth first from
 * the start step, likelier branches first), then anything unreachable, top to
 * bottom. DOM order is focus order, so nodes and edges are listed this way.
 */
function flowOrder(bundle: ProcessBundle): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const e of [...bundle.edges].sort((a, b) => Number(b.probability) - Number(a.probability))) {
    next.set(e.from_step_id, [...(next.get(e.from_step_id) ?? []), e.to_step_id]);
  }
  const order = new Map<string, number>();
  const queue = bundle.steps.filter((s) => s.kind === "start").map((s) => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (order.has(id)) continue;
    order.set(id, order.size);
    queue.push(...(next.get(id) ?? []));
  }
  const rest = bundle.steps
    .filter((s) => !order.has(s.id))
    .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x));
  for (const s of rest) order.set(s.id, order.size);
  return order;
}

interface CanvasProps {
  bundle: ProcessBundle;
  result: SimulationResult | null;
  /** Null for a read-only canvas. */
  editor: ProcessEditor | null;
  editorState: EditorState | null;
  selection: Selection;
  onSelectionChange: Dispatch<SetStateAction<Selection>>;
  /** Duplicate, copy, delete and inspect, shared with the keyboard shortcuts. */
  commands: CanvasCommands | null;
}

export function ProcessCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ bundle, result, editor, editorState, selection, onSelectionChange, commands }: CanvasProps) {
  const editable = editor !== null;
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  // Positions of nodes mid-drag, and sizes React Flow measured; the rest comes from the bundle.
  const [dragging, setDragging] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());
  const [lanes, setLanes] = useState(false);
  const [editing, setEditing] = useState<{ id: string; field: InlineField } | null>(null);
  const [menu, setMenu] = useState<(MenuState & { bounds: { width: number; height: number } }) | null>(null);
  // Which step's menu is open, synchronously, so the context-menu event that follows Shift+F10 doesn't reopen it.
  const menuFor = useRef<string | null>(null);
  const playback = usePlayback(bundle, result);

  const warnings = useMemo(() => (editable ? stepWarnings(bundle) : new Map<string, string>()), [bundle, editable]);
  const order = useMemo(() => flowOrder(bundle), [bundle]);
  const editingId = editing && bundle.steps.some((s) => s.id === editing.id) ? editing.id : null;
  const layout = useMemo(() => {
    if (!lanes) return null;
    // The card being edited grows; its lane keeps its size meanwhile.
    const sizes = new Map([...measured].filter(([id]) => id !== editingId));
    return laneLayout(bundle, sizes);
  }, [lanes, bundle, measured, editingId]);

  // The last node object made for each step (see sameNode).
  const [nodeCache] = useState(() => new Map<string, FlowNode>());
  const nodes = useMemo(() => {
    const roles = new Map(bundle.roles.map((r) => [r.id, r]));
    const people = new Map(bundle.people.map((p) => [p.id, p]));
    const names = new Map(bundle.steps.map((s) => [s.id, s.name]));
    const selected = new Set(selection.steps);
    return [...bundle.steps]
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((step): FlowNode => {
        const data: StepNodeData = {
          step,
          role: step.role_id ? (roles.get(step.role_id) ?? null) : null,
          person: step.person_id ? (people.get(step.person_id) ?? null) : null,
          avgQueue: result?.steps[step.id]?.avgQueue ?? null,
          bottleneck: result?.bnStep === step.id,
          warning: warnings.get(step.id) ?? null,
          editable,
          reworkTo: step.rework_to_step_id ? (names.get(step.rework_to_step_id) ?? null) : null,
          editing: editing && editingId === step.id ? editing.field : null,
          pulse: playback.pulsing && result?.bnStep === step.id,
        };
        const node: FlowNode = {
          id: step.id,
          type: step.kind === "start" || step.kind === "end" ? "terminal" : "step",
          position: dragging.get(step.id) ?? layout?.positions.get(step.id) ?? { x: Number(step.x), y: Number(step.y) },
          selected: selected.has(step.id),
          ariaLabel: stepLabel(data),
          // The card being edited sits above its neighbours.
          ...(data.editing ? { zIndex: 1000 } : {}),
          ...(measured.has(step.id) ? { measured: measured.get(step.id) } : {}),
          data,
        };
        // Hand React Flow the same object for a step that hasn't changed, so only changed cards re-render.
        const prev = nodeCache.get(step.id);
        if (prev && sameNode(prev, node)) return prev;
        nodeCache.set(step.id, node);
        return node;
      });
  }, [bundle, result, selection.steps, dragging, measured, warnings, editable, order, layout, editing, editingId, nodeCache, playback.pulsing]);

  const edges = useMemo(() => {
    const selected = new Set(selection.edges);
    const alone = selection.edges.length === 1 && !selection.steps.length;
    const names = new Map(bundle.steps.map((s) => [s.id, s.name]));
    const rank = (e: { from_step_id: string; to_step_id: string }) => (order.get(e.from_step_id) ?? 0) * 1e4 + (order.get(e.to_step_id) ?? 0);
    return [...bundle.edges]
      .sort((a, b) => rank(a) - rank(b))
      .map(
        (e): BranchFlowEdge => ({
          id: e.id,
          source: e.from_step_id,
          target: e.to_step_id,
          type: "branch",
          selected: selected.has(e.id),
          data: { probability: Number(e.probability), tag: e.condition_tag, alone },
          style: { stroke: selected.has(e.id) ? "var(--accent)" : "var(--line-2)", strokeWidth: selected.has(e.id) ? 2.5 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: selected.has(e.id) ? "var(--accent)" : "var(--line-2)" },
          ariaLabel: `Connection from ${names.get(e.from_step_id)} to ${names.get(e.to_step_id)}, ${percent(Number(e.probability))}${e.condition_tag ? `, tag ${e.condition_tag}` : ""}`,
        }),
      );
  }, [bundle, selection.edges, selection.steps.length, order]);

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
          // Lanes place steps top to bottom by role, so in the lane view only left and right are saved.
          const stored = bundle.steps.find((s) => s.id === c.id);
          moves.push({ id: c.id, x: c.position.x, y: layout && stored ? Number(stored.y) : c.position.y });
          drags.delete(c.id);
        }
        moved = true;
      } else if (c.type === "select") picks.push({ id: c.id, selected: c.selected });
    }
    if (sized) setMeasured(sizes);
    // Everything dragged together arrives in one change list: one edit, one undo step.
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

  /** Focus a step's card, or the map itself if the step is gone. */
  const focusStep = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = wrapper.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      (el ?? wrapper.current)?.focus();
    });
  }, []);

  const startEditing = (id: string, field: InlineField) => {
    const step = bundle.steps.find((s) => s.id === id);
    if (!editable || !step) return;
    const terminal = step.kind === "start" || step.kind === "end";
    setMenu(null);
    menuFor.current = null;
    setEditing({ id, field: terminal ? "name" : field });
    onSelectionChange({ steps: [id], edges: [] });
  };

  const stopEditing = useCallback(
    (id: string, refocus: boolean) => {
      setEditing((e) => (e?.id === id ? null : e));
      if (refocus) focusStep(id);
    },
    [focusStep],
  );

  const inline = useMemo<InlineEditing | null>(
    () => (editor ? { editor, bundle, stop: stopEditing } : null),
    [editor, bundle, stopEditing],
  );

  /** Open a step's menu at a point relative to the canvas. */
  const openMenu = (id: string, x: number, y: number, ids?: string[]) => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!editable || !rect) return;
    const acting = ids ?? (selection.steps.includes(id) && selection.steps.length > 1 ? selection.steps : [id]);
    if (acting.length === 1) onSelectionChange({ steps: [id], edges: [] });
    setEditing(null);
    menuFor.current = id;
    setMenu({ id, ids: acting, x, y, bounds: { width: rect.width, height: rect.height } });
  };

  const closeMenu = useCallback(
    (refocus: boolean) => {
      const id = menuFor.current;
      menuFor.current = null;
      setMenu(null);
      if (refocus && id) focusStep(id);
    },
    [focusStep],
  );

  /** Open the menu under a step's card, for the keyboard. */
  const openMenuBelow = (el: Element, id: string) => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    const r = el.getBoundingClientRect();
    openMenu(id, r.left - rect.left + 8, r.bottom - rect.top + 4);
  };

  // Keys on a focused step or connection, before React Flow's own handling.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || !(e.target instanceof Element)) return;
    const target = e.target;
    if (target.closest("input, textarea, select, [role='menu']")) return;
    const isNode = target.classList.contains("react-flow__node");
    const isEdge = target.classList.contains("react-flow__edge");
    const id = isNode || isEdge ? target.getAttribute("data-id") : null;
    if (!id) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (isNode && (e.key === "Enter" || e.key === "F2")) {
      stop();
      startEditing(id, "name");
    } else if (isNode && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
      stop();
      openMenuBelow(target, id);
    } else if (isEdge && e.key === "Enter") {
      stop();
      onSelectionChange({ steps: [], edges: [id] });
      // The editor appears once the edge is selected; then move into it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          wrapper.current?.querySelector<HTMLInputElement>(`[data-edge-editor="${id}"] input`)?.focus(),
        ),
      );
    } else if (e.key === "Escape") {
      // React Flow would select an unselected node on Escape; clear the selection instead.
      stop();
      onSelectionChange(NO_SELECTION);
    }
  };

  const toggleLanes = () => {
    const next = !lanes;
    setLanes(next);
    // Once the steps have moved to (or out of) their lanes, frame them.
    setTimeout(() => void flow.fitView({ padding: fitPadding(next), duration: 200 }), 50);
  };

  return (
    <CanvasContext.Provider value={{ editor }}>
      <InlineEditContext.Provider value={inline}>
        <div
          ref={wrapper}
          data-process-map
          tabIndex={-1}
          onDoubleClick={onDoubleClick}
          onKeyDownCapture={onKeyDownCapture}
          className="relative h-[28rem] w-full rounded-token border border-line bg-panel md:h-[34rem]"
          role="region"
          aria-label={`${bundle.process.name} process map`}
        >
          {/* Before the map in the page, so Tab reaches the toolbar first. */}
          {editable && editorState && (
            <div className="absolute top-2.5 left-2.5 z-10 max-w-[calc(100%-1.25rem)]">
              <Toolbar bundle={bundle} editor={editor} state={editorState} onAdd={addFromToolbar} lanes={lanes} onToggleLanes={toggleLanes} />
            </div>
          )}
          {!editable && (
            <div className="absolute top-2.5 left-2.5 z-10">
              <LaneToggle lanes={lanes} onToggle={toggleLanes} />
            </div>
          )}
          {/* Playback of the run (issue #14), over the foot of the map; before it in the page, for Tab. */}
          <div className="absolute right-2.5 bottom-2.5 left-2.5 z-10">
            <PlaybackBar
              clock={playback.clock}
              H={playback.index?.H ?? null}
              hoursPerWeek={playback.hoursPerWeek}
              reps={result?.reps ?? null}
              describe={playback.describe}
            />
          </div>
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
            onNodeDoubleClick={(e, node) => {
              if (!(e.target instanceof Element) || e.target.closest("input, select, .nokey")) return;
              const field = e.target.closest("[data-field]")?.getAttribute("data-field") as InlineField | null;
              startEditing(node.id, field ?? "name");
            }}
            onNodeContextMenu={(e, node) => {
              if (!editable) return;
              e.preventDefault();
              if (menuFor.current === node.id) return;
              const rect = wrapper.current!.getBoundingClientRect();
              // A context-menu key press arrives without a pointer position.
              if (e.clientX === 0 && e.clientY === 0 && e.currentTarget instanceof Element) openMenuBelow(e.currentTarget, node.id);
              else openMenu(node.id, e.clientX - rect.left, e.clientY - rect.top);
            }}
            onSelectionContextMenu={(e, picked) => {
              if (!editable || !picked.length) return;
              e.preventDefault();
              const rect = wrapper.current!.getBoundingClientRect();
              openMenu(
                picked[0]!.id,
                e.clientX - rect.left,
                e.clientY - rect.top,
                picked.map((n) => n.id),
              );
            }}
            edgesReconnectable={editable}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable={editable}
            edgesFocusable={editable}
            // Deleting goes through the editor (see ProcessView), never React Flow's own delete.
            deleteKeyCode={null}
            // Shift-drag draws a selection box; Shift-, Ctrl- or ⌘-click adds to the selection.
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            selectionMode={SelectionMode.Partial}
            zoomOnDoubleClick={false}
            // The menu belongs where it was opened; moving the map closes it.
            onMoveStart={() => menuFor.current && closeMenu(false)}
            ariaLabelConfig={editable ? EDIT_ARIA : undefined}
            fitView
            fitViewOptions={{ padding: fitPadding(false) }}
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--line)" gap={24} />
            {layout && <LaneLayer lanes={layout.lanes} />}
            {playback.index && (
              <PlaybackLayer
                clock={playback.clock}
                index={playback.index}
                steps={playback.steps}
                bottleneck={result?.bnStep ?? null}
                reducedMotion={playback.reducedMotion}
              />
            )}
          </ReactFlow>
          {menu && editor && commands && (
            <NodeMenu
              key={menu.id}
              menu={menu}
              bounds={menu.bounds}
              bundle={bundle}
              editor={editor}
              commands={commands}
              onRename={(id) => startEditing(id, "name")}
              onClose={closeMenu}
            />
          )}
        </div>
      </InlineEditContext.Provider>
    </CanvasContext.Provider>
  );
}

/** Swimlanes, drawn under the map in its coordinates, so they pan and zoom with it. */
function LaneLayer({ lanes }: { lanes: Lane[] }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  return (
    <div aria-hidden className="react-flow__container pointer-events-none overflow-hidden" style={{ zIndex: -1 }}>
      <div className="absolute top-0 left-0" style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        {lanes.map((lane, i) => (
          <div
            key={lane.key}
            className={`absolute border-b border-line ${i % 2 ? "bg-panel" : "bg-panel-2/60"} ${i === 0 ? "border-t" : ""}`}
            style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
          >
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: lane.color ?? "var(--line-2)" }} />
          </div>
        ))}
      </div>
      {/* Names stay readable at any zoom and in view while the map pans sideways. */}
      {lanes.map((lane) => (
        <p
          key={lane.key}
          className="absolute max-w-32 truncate text-xs font-semibold text-fg-2"
          style={{ left: Math.max(8, tx + lane.x * zoom + 10), top: ty + lane.y * zoom + 6 }}
        >
          {lane.label}
        </p>
      ))}
    </div>
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

function LaneToggle({ lanes, onToggle }: { lanes: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={lanes}
      onClick={onToggle}
      title="Group steps in lanes by role. A step's lane follows its role; dragging moves steps left or right."
      className={`${toolButton} text-xs ${lanes ? "!border-accent !bg-accent-soft" : ""}`}
    >
      Swimlanes
    </button>
  );
}

/** Add a step, undo, redo, the swimlane view, and whether edits are saved. */
function Toolbar({
  bundle,
  editor,
  state,
  onAdd,
  lanes,
  onToggleLanes,
}: {
  bundle: ProcessBundle;
  editor: ProcessEditor;
  state: EditorState;
  onAdd: (kind: NewStepKind, outcome: StepOutcome | null) => void;
  lanes: boolean;
  onToggleLanes: () => void;
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
      <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
      <LaneToggle lanes={lanes} onToggle={onToggleLanes} />
      <KeysHelp mod={mod} />
      <span className="px-1 text-fg-3" aria-live="polite">
        {state.saving ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Tab", "move between steps and connections"],
  ["Enter / F2", "edit the focused step here (Enter saves a field, Esc cancels)"],
  ["Shift+F10", "the focused step's actions"],
  ["Space", "select (Shift+Space adds to the selection)"],
  ["Arrows", "move selected steps (Shift: further)"],
  ["Shift+drag", "select with a box; Shift+click adds"],
  ["mod+C / mod+V", "copy and paste steps"],
  ["mod+D", "duplicate selected steps"],
  ["mod+A", "select every step"],
  ["Delete", "delete what is selected"],
  ["mod+Z / mod+Y", "undo / redo"],
  ["Esc", "clear the selection"],
  ["Space (playback bar)", "play or pause"],
  ["Arrows (scrubber)", "an hour (Shift: a day); Page Up/Down: a week"],
];

function KeysHelp({ mod }: { mod: string }) {
  return (
    <details className="relative">
      <summary className={`${toolButton} cursor-pointer list-none`} aria-label="Keyboard shortcuts">
        Keys
      </summary>
      <div className="absolute top-full left-0 z-20 mt-1 w-80 rounded-token border border-line bg-panel p-2 shadow-token">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {KEYS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-[11px] whitespace-nowrap text-fg">{keys.replaceAll("mod+", mod)}</dt>
              <dd className="text-fg-2">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
