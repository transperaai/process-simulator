// The company map as a map (issue #100, A35): the Overview draws every process as one card on the same canvas the
// process page uses, read-only. Each process becomes a group step holding its steps; a child process becomes a group
// inside its parent, in the place of the step that held it. Opening a group shows what is in it, closing it rolls
// the steps up (their count, hours, issues and worst rating), so the canvas needs nothing new.
//
// The groups are laid out here, not stored: opening one makes it bigger, so what sits beside and below it moves
// out of the way. Pure: the same processes and the same open groups always give the same map.

import { isGroup, type EdgeRow, type ProcessBundle, type ProcessPart, type StepRow } from "@transpera-flow/db";
import { GROUP_CARD, GROUP_PADDING, openGroupSize, type Size } from "@/lib/map/groups";

/** Space between cards, side to side and top to bottom. */
const GAP_X = 96;
const GAP_Y = 36;

export interface CompanyMap {
  /** The map as a process bundle for the canvas: one group step per process, its steps inside. */
  bundle: ProcessBundle;
  /** The process a step (or a process's own group) belongs to, to open its page. */
  processOfStep: ReadonlyMap<string, string>;
  /** Every process on the map, for the "N processes" count. */
  processIds: readonly string[];
}

/** A process's own steps are placed in a box; this is the part of a step row the map keeps. */
type Template = StepRow;

function groupRow(template: Template, part: ProcessPart, over: Partial<StepRow>): StepRow {
  return {
    ...template,
    id: part.process.id,
    revision_id: part.revision.id,
    process_id: part.process.id,
    name: part.process.name,
    kind: "group",
    outcome: null,
    role_id: null,
    person_id: null,
    work_hours: 0,
    wait_hours: 0,
    rework_rate: 0,
    rework_to_step_id: null,
    tool: null,
    notes: null,
    sla_hours: null,
    expected_wait_hours: null,
    lost_per_day_waiting: null,
    dropoff_benchmark: null,
    target_cycle_hours: null,
    current_wip: null,
    parent_step_id: null,
    entry_step_id: null,
    child_process_id: null,
    assumption: false,
    conflict: false,
    provenance: {},
    x: 0,
    y: 0,
    ...over,
  };
}

const edgeRow = (template: EdgeRow | undefined, workspaceId: string, from: string, to: string, label: string | null = null): EdgeRow => ({
  id: `company:${from}:${to}`,
  revision_id: template?.revision_id ?? "company",
  workspace_id: workspaceId,
  process_id: template?.process_id ?? "company",
  from_step_id: from,
  to_step_id: to,
  probability: 1,
  condition_tag: null,
  label,
});

/**
 * One process as steps inside its group. Its start and end markers are dropped; a step holding a child process becomes
 * that child's group (so a connection to the holder leads to the group); the others keep their own groups and order.
 * Positions are made relative to the group's box.
 */
function inside(part: ProcessPart, byProcess: ReadonlyMap<string, ProcessPart>, template: Template, seen: ReadonlySet<string>, out: { steps: StepRow[]; edges: EdgeRow[] }): void {
  const gid = part.process.id;
  const own = part.steps.filter((s) => s.kind !== "start" && s.kind !== "end");
  const markers = new Set(part.steps.filter((s) => s.kind === "start" || s.kind === "end").map((s) => s.id));
  const top = own.filter((s) => !s.parent_step_id);
  const minX = top.length ? Math.min(...top.map((s) => Number(s.x))) : 0;
  const minY = top.length ? Math.min(...top.map((s) => Number(s.y))) : 0;
  /** A holder step's id → the group of the child process it holds. */
  const holders = new Map<string, string>();
  for (const s of own) {
    const child = s.child_process_id ? byProcess.get(s.child_process_id) : undefined;
    if (child && !seen.has(child.process.id)) holders.set(s.id, child.process.id);
  }
  const target = (id: string) => holders.get(id) ?? id;
  const adopted: StepRow[] = [];
  for (const s of own) {
    const atTop = !s.parent_step_id;
    const x = atTop ? Number(s.x) - minX + GROUP_PADDING.left : Number(s.x);
    const y = atTop ? Number(s.y) - minY + GROUP_PADDING.top : Number(s.y);
    const child = holders.get(s.id);
    if (child) {
      // The child process takes the holder's place (and its position), inside this group.
      adopted.push(groupRow(template, byProcess.get(child)!, { parent_step_id: atTop ? gid : s.parent_step_id, x, y }));
      continue;
    }
    // A holder whose child isn't known stays as the step it is.
    adopted.push({ ...s, parent_step_id: atTop ? gid : s.parent_step_id, x, y });
  }
  out.steps.push(...adopted);
  for (const e of part.edges) {
    if (markers.has(e.from_step_id) || markers.has(e.to_step_id)) continue;
    out.edges.push({ ...e, from_step_id: target(e.from_step_id), to_step_id: target(e.to_step_id) });
  }
  // Where entities enter: the step the start marker leads to.
  const startIds = new Set(part.steps.filter((s) => s.kind === "start").map((s) => s.id));
  const first = part.edges.find((e) => startIds.has(e.from_step_id))?.to_step_id;
  const entry = first ? target(first) : null;
  const group = out.steps.find((s) => s.id === gid);
  if (group && entry && out.steps.some((s) => s.id === entry && s.parent_step_id === gid)) group.entry_step_id = entry;
  for (const child of new Set(holders.values())) inside(byProcess.get(child)!, byProcess, template, new Set([...seen, child]), out);
}

/** Opening a group inside a process makes it bigger: what is to its right moves right, what is below it moves down. */
function makeRoom(steps: StepRow[], groupId: string, expanded: ReadonlySet<string>, all: readonly StepRow[]): void {
  const kids = steps.filter((s) => s.parent_step_id === groupId);
  const sizeOf = (s: StepRow): Size => (isGroup(s) && expanded.has(s.id) ? openGroupSize(all, s.id, expanded) : isGroup(s) ? GROUP_CARD : { width: 192, height: 92 });
  const opened = kids.filter((s) => isGroup(s) && expanded.has(s.id)).sort((a, b) => Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y));
  for (const g of opened) {
    const grown = sizeOf(g);
    const dx = Math.max(0, grown.width - GROUP_CARD.width);
    const dy = Math.max(0, grown.height - GROUP_CARD.height);
    const right = Number(g.x) + GROUP_CARD.width;
    const below = Number(g.y) + GROUP_CARD.height;
    for (const s of kids) {
      if (s === g) continue;
      if (dx && Number(s.x) >= right - 1) s.x = Number(s.x) + dx;
      else if (dy && Number(s.y) >= below - 1 && Number(s.x) < right) s.y = Number(s.y) + dy;
    }
  }
  for (const g of opened) makeRoom(steps, g.id, expanded, all);
}

/**
 * The company map. Top-level processes go in columns: sales pipelines first, then the processes that serve clients
 * after a win, each one a card (or a box, when open). Child processes sit inside their parents.
 */
export function companyMap(base: ProcessBundle, parts: readonly ProcessPart[], expanded: ReadonlySet<string> = new Set()): CompanyMap {
  const byProcess = new Map(parts.map((p) => [p.process.id, p]));
  const template = parts.flatMap((p) => p.steps)[0];
  const processOfStep = new Map<string, string>();
  if (!template) {
    return { bundle: { ...base, steps: [], edges: [], otherProcesses: [] }, processOfStep, processIds: [] };
  }
  const known = new Set(parts.map((p) => p.process.id));
  const isTop = (p: ProcessPart) => !p.process.parent_process_id || !known.has(p.process.parent_process_id) || p.process.parent_process_id === p.process.id;
  const tops = parts.filter(isTop);
  const out: { steps: StepRow[]; edges: EdgeRow[] } = { steps: [], edges: [] };
  for (const part of tops) {
    out.steps.push(groupRow(template, part, {}));
    inside(part, byProcess, template, new Set([part.process.id]), out);
  }
  // A child process nobody holds still belongs on the map: it sits inside its parent after the held ones.
  const placed = new Set(out.steps.filter((s) => s.kind === "group" && known.has(s.id)).map((s) => s.id));
  for (const part of parts) {
    if (placed.has(part.process.id) || isTop(part)) continue;
    const parent = part.process.parent_process_id!;
    if (!placed.has(parent)) continue;
    const siblings = out.steps.filter((s) => s.parent_step_id === parent);
    const right = Math.max(GROUP_PADDING.left, ...siblings.map((s) => Number(s.x) + (isGroup(s) ? GROUP_CARD.width : 192) + 40));
    out.steps.push(groupRow(template, part, { parent_step_id: parent, x: right, y: GROUP_PADDING.top }));
    placed.add(part.process.id);
    inside(part, byProcess, template, new Set([part.process.id]), out);
  }
  // Which process each step belongs to (a process's own group, its steps, and the groups inside it).
  for (const s of out.steps) processOfStep.set(s.id, known.has(s.id) ? s.id : s.process_id);

  const all = out.steps;
  for (const part of tops) makeRoom(all, part.process.id, expanded, all);

  // Columns: pipelines, then everything that serves clients. A card's size depends on whether it is open.
  const columns: ProcessPart[][] = [tops.filter((p) => p.process.kind !== "servicing"), tops.filter((p) => p.process.kind === "servicing")].filter((c) => c.length);
  const sizeOf = (id: string): Size => (expanded.has(id) ? openGroupSize(all, id, expanded) : GROUP_CARD);
  let x = 0;
  const heights = columns.map((col) => col.reduce((h, p) => h + sizeOf(p.process.id).height, 0) + GAP_Y * (col.length - 1));
  const tallest = Math.max(0, ...heights);
  columns.forEach((col, ci) => {
    let y = (tallest - heights[ci]!) / 2;
    for (const part of col) {
      const g = all.find((s) => s.id === part.process.id)!;
      g.x = x;
      g.y = y;
      y += sizeOf(part.process.id).height + GAP_Y;
    }
    x += Math.max(...col.map((p) => sizeOf(p.process.id).width)) + GAP_X;
  });
  // A pipeline hands its wins to the processes that serve them: one connection from each pipeline to each servicing process.
  const [pipelines, servicing] = columns.length === 2 ? columns : [[], []];
  for (const from of pipelines) for (const to of servicing) out.edges.push(edgeRow(from.edges[0], base.workspace.id, from.process.id, to.process.id));

  // Only what is on the map: no connection to a step that isn't.
  const ids = new Set(all.map((s) => s.id));
  const edges = out.edges.filter((e) => ids.has(e.from_step_id) && ids.has(e.to_step_id));
  const bundle: ProcessBundle = {
    ...base,
    process: { ...base.process, id: "company", name: base.workspace.name, parent_process_id: null },
    steps: all,
    edges,
    retired: [],
    otherProcesses: [],
  };
  return { bundle, processOfStep, processIds: parts.map((p) => p.process.id) };
}
