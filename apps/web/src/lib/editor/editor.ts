// The process editor's state (issue #8): the process as the editor shows it,
// undo and redo, saving, and same-field conflicts. Framework-free so it can be
// unit tested; `useDraftSession` (lib/drafts) wraps it for React.
//
// Edits apply to the local copy at once (optimistic) and are saved in order,
// one at a time, so each save's `base` is what the previous one stored. Undo
// applies an edit's inverse and saves it like any other edit. A same-field
// conflict keeps our value on screen and waits for "keep mine" / "keep
// theirs"; a failed save rolls back what didn't save.
//
// Other people's saves arrive through `applyRemote` (issue #10) and are merged
// by a RemoteChangeMerger (lib/realtime/merge.ts): they update the copy the
// next compare-and-set is checked against, never the undo history, and never
// a field we are still saving. Undo and redo are compare-and-set saves like
// any edit, so undoing a field someone else has since changed is a conflict
// (keep mine / keep theirs), not an overwrite.

import type { EdgeRow, ProcessBundle, StepRow } from "@transpera-flow/db";
import { RemoteChangeMerger, type Applied, type UnitOutcome } from "@/lib/realtime/merge";
import type { RemoteChange } from "@/lib/realtime/rows";
import {
  applyOp,
  invertEdit,
  invertOp,
  readField,
  saveUnits,
  unitOp,
  type Edit,
  type Op,
  type Patch,
  type RowChange,
  type SaveUnit,
  type Value,
  type Table,
} from "./ops";
import { isProvenanceField, provenanceFieldFor, stampProvenance, type Stamp } from "./provenance";
import type { ProcessStore } from "./store";

/** A field someone else changed while we were editing it. */
export interface Conflict {
  table: Table;
  id: string;
  field: string;
  /** What we tried to save (still shown). */
  mine: Value;
  /** What is stored now. */
  theirs: Value;
  /**
   * Set when the clash was noticed before saving (someone else saved the
   * field while it was being typed): "keep mine" re-runs the edit on top of
   * theirs, so it is an ordinary undoable edit.
   */
  retry?: (bundle: ProcessBundle) => Edit | null;
}

export interface EditorState {
  bundle: ProcessBundle;
  /** Labels of the edits undo and redo would step over. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Saves still in flight. */
  saving: boolean;
  conflicts: Conflict[];
  /** The last save that failed, until dismissed. */
  error: string | null;
}

/** A save of ours went through: which fields of which row now hold what, or which rows were added or removed. */
export type Saved =
  | { kind: "update"; table: Table; id: string; values: Patch }
  | { kind: "insert" | "remove"; steps: string[]; edges: string[] };
export type SavedListener = (saved: Saved) => void;
/** Someone else's changes were merged in. */
export type RemoteListener = (applied: Applied[]) => void;

export const SAVE_FAILED = "Couldn't save that change, so it was rolled back. Check your connection and try again.";
export const GONE = "That item was removed by someone else, or you don't have permission to edit it.";
const ROLLED_BACK = "The change was rolled back.";

const conflictKey = (c: Pick<Conflict, "table" | "id" | "field">) => `${c.table}:${c.id}:${c.field}`;

export class ProcessEditor {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private readonly merger: RemoteChangeMerger;
  private savedListeners = new Set<SavedListener>();
  private remoteListeners = new Set<RemoteListener>();

  constructor(
    bundle: ProcessBundle,
    private readonly store: ProcessStore,
    /** Who is editing, and when: step parameters they change are recorded as entered (./provenance.ts). */
    private readonly stamp?: () => Stamp,
    now: () => number = Date.now,
  ) {
    this.state = { bundle, undoLabel: null, redoLabel: null, saving: false, conflicts: [], error: null };
    this.merger = new RemoteChangeMerger(now);
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Run an edit built against the current process. Returns whether anything changed. */
  run(build: (bundle: ProcessBundle) => Edit | null): boolean {
    const built = build(this.state.bundle);
    const edit = built && this.stamp ? stampProvenance(this.state.bundle, built, this.stamp()) : built;
    if (!edit || !edit.ops.length) return false;
    this.undoStack.push(edit);
    this.redoStack = [];
    this.perform(edit, edit, "do");
    return true;
  }

  undo(): boolean {
    const edit = this.undoStack.pop();
    if (!edit) return false;
    this.redoStack.push(edit);
    this.perform(invertEdit(edit), edit, "undo");
    return true;
  }

  redo(): boolean {
    const edit = this.redoStack.pop();
    if (!edit) return false;
    this.undoStack.push(edit);
    this.perform(edit, edit, "do");
    return true;
  }

  /** Save our value over theirs (and our provenance for it, if that clashed too). */
  keepMine(conflict: Conflict): Promise<void> {
    const all = this.withCompanion(conflict);
    all.forEach((c) => this.dropConflict(c));
    if (conflict.retry) {
      // Start from theirs, as the edit would have if we'd seen it in time (stamped as ours again).
      for (const c of all) this.setField(c, c.theirs);
      this.run(conflict.retry);
      return this.queue;
    }
    const change: RowChange = {
      table: conflict.table,
      id: conflict.id,
      before: Object.fromEntries(all.map((c) => [c.field, c.theirs])),
      after: Object.fromEntries(all.map((c) => [c.field, c.mine])),
    };
    for (const c of all) this.setField(c, c.mine);
    const unit: SaveUnit = { kind: "update", change };
    this.merger.begin(unit);
    return this.enqueue(async () => {
      this.finish(unit, await this.save(unit));
    });
  }

  /** Take the stored value (and its provenance). Not an edit of ours, so it isn't undoable. */
  keepTheirs(conflict: Conflict): void {
    const all = this.withCompanion(conflict);
    all.forEach((c) => this.dropConflict(c));
    for (const c of all) this.setField(c, c.theirs);
  }

  /** A conflict, plus the conflict on its value's provenance, which is settled with it and never shown. */
  private withCompanion(conflict: Conflict): Conflict[] {
    const key = provenanceFieldFor(conflict.field);
    const companion = key && this.state.conflicts.find((c) => c.table === conflict.table && c.id === conflict.id && c.field === key);
    return companion ? [conflict, companion] : [conflict];
  }

  /**
   * Someone else saved a field while the user was typing a new value for it
   * (the input keeps the typing when a remote change arrives). Show the
   * user's value and ask keep mine / keep theirs, instead of silently saving
   * over theirs.
   */
  raiseConflict(conflict: Conflict): void {
    const key = conflictKey(conflict);
    this.setField(conflict, conflict.mine);
    this.set({ conflicts: [...this.state.conflicts.filter((c) => conflictKey(c) !== key), conflict] });
  }

  /**
   * Merge a change someone else saved (from Realtime, or the demo's simulated
   * colleague). Not undoable, and never overwrites a field we are saving or
   * one in conflict; see lib/realtime/merge.ts.
   */
  applyRemote(change: RemoteChange): void {
    const r = this.merger.merge(this.state.bundle, this.state.conflicts, change);
    if (r.bundle !== this.state.bundle || r.conflicts !== this.state.conflicts) this.set({ bundle: r.bundle, conflicts: r.conflicts });
    if (r.applied) this.emitRemote([r.applied]);
  }

  /**
   * Bring the copy in line with the revision's stored rows, as after a
   * reconnect, when changes may have been missed. Our in-flight saves and
   * conflicts are kept, as in `applyRemote`.
   */
  resync(rows: { steps: StepRow[]; edges: EdgeRow[] }): void {
    let { bundle, conflicts } = this.state;
    const applied: Applied[] = [];
    const merge = (change: RemoteChange) => {
      const r = this.merger.merge(bundle, conflicts, change, true);
      ({ bundle, conflicts } = r);
      if (r.applied) applied.push(r.applied);
    };
    for (const row of rows.steps) merge({ kind: "upsert", table: "steps", row });
    for (const row of rows.edges) merge({ kind: "upsert", table: "edges", row });
    const stored = { steps: new Set(rows.steps.map((s) => s.id)), edges: new Set(rows.edges.map((e) => e.id)) };
    for (const e of bundle.edges) if (!stored.edges.has(e.id)) merge({ kind: "delete", table: "edges", id: e.id });
    for (const s of bundle.steps) if (!stored.steps.has(s.id)) merge({ kind: "delete", table: "steps", id: s.id });
    if (bundle !== this.state.bundle || conflicts !== this.state.conflicts) this.set({ bundle, conflicts });
    if (applied.length) this.emitRemote(applied);
  }

  /** Listen for our saves going through (to tell others who made them). */
  onSaved(listener: SavedListener): () => void {
    this.savedListeners.add(listener);
    return () => this.savedListeners.delete(listener);
  }

  /** Listen for other people's changes being merged in. */
  onRemote(listener: RemoteListener): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }

  dismissError(): void {
    this.set({ error: null });
  }

  /**
   * Start over from `bundle`, with no history, conflicts or error: after a
   * draft is published or discarded, its edits can't be undone one by one.
   * Call once saves have settled.
   */
  reset(bundle: ProcessBundle): void {
    this.undoStack = [];
    this.redoStack = [];
    this.merger.reset();
    this.set({ bundle, undoLabel: null, redoLabel: null, conflicts: [], error: null });
  }
  /** Resolves once every save queued so far has finished. */
  settled(): Promise<void> {
    return this.queue;
  }

  /**
   * Apply `edit` locally now and save it in order. `origin` is the history
   * entry it came from; `mode` says whether this does or undoes it.
   */
  private perform(edit: Edit, origin: Edit, mode: "do" | "undo"): void {
    for (const op of edit.ops) this.applyLocal(op);
    this.syncHistory();
    const list = saveUnits(edit);
    for (const unit of list) this.merger.begin(unit);
    void this.enqueue(async () => {
      for (let i = 0; i < list.length; i++) {
        const outcome = await this.save(list[i]!);
        if (outcome.kind === "saved") {
          this.finish(list[i]!, outcome);
          continue;
        }
        // Roll back what didn't save, newest first. A failed edit leaves
        // history; after a failed undo the edit stays where undo can retry it.
        for (let j = list.length - 1; j >= i; j--) this.applyLocal(invertOp(unitOp(list[j]!)));
        for (let j = i; j < list.length; j++) this.finish(list[j]!, outcome);
        this.undoStack = this.undoStack.filter((e) => e !== origin);
        this.redoStack = this.redoStack.filter((e) => e !== origin);
        if (mode === "undo") this.undoStack.push(origin);
        this.syncHistory();
        return;
      }
    });
  }

  /** A unit's save ended: show anything newer that arrived meanwhile, and tell listeners what saved. */
  private finish(unit: SaveUnit, outcome: UnitOutcome): void {
    const late = this.merger.end(unit, outcome);
    if (late) {
      this.applyLocal({ kind: "update", changes: [{ table: late.table, id: late.id, before: {}, after: late.values }] });
      this.emitRemote([{ table: late.table, id: late.id, kind: "changed", values: late.values }]);
    }
    if (outcome.kind !== "saved") return;
    let saved: Saved;
    if (unit.kind === "update") {
      const { table, id, after } = unit.change;
      const values: Patch = {};
      for (const [f, v] of Object.entries(after)) if (!outcome.conflicted.has(f)) values[f] = v;
      if (!Object.keys(values).length) return;
      saved = { kind: "update", table, id, values };
    } else {
      saved = { kind: unit.kind, steps: unit.steps.map((s) => s.id), edges: unit.edges.map((e) => e.id) };
    }
    for (const listener of this.savedListeners) listener(saved);
  }

  /**
   * Save one unit. "failed" if it didn't save; a conflict counts as saved,
   * pending the user's choice, and lists the fields in conflict.
   */
  private async save(unit: SaveUnit): Promise<UnitOutcome> {
    const failed = { kind: "failed" } as const;
    const saved = (conflicted: ReadonlySet<string> = new Set()): UnitOutcome => ({ kind: "saved", conflicted });
    try {
      if (unit.kind === "insert" || unit.kind === "remove") {
        const r =
          unit.kind === "insert"
            ? await this.store.insert(unit.steps, unit.edges)
            : await this.store.remove(
                unit.steps.map((s) => s.id),
                unit.edges.map((e) => e.id),
              );
        if (r.status === "ok") return saved();
        this.set({ error: `${r.message} ${ROLLED_BACK}` });
        return failed;
      }
      const { table, id, after } = unit.change;
      const r = await this.store.update(table, id, unit.change.before, after);
      if (r.status === "saved" || r.status === "conflict") {
        const theirs: Patch = r.status === "conflict" ? r.theirs : {};
        // Provenance that clashed while its value didn't (say, both of us entered
        // the same number): the value stands, so take the stored provenance.
        const valueClashed = new Set(Object.keys(theirs).map(provenanceFieldFor));
        const adopt: Patch = {};
        let conflicts = this.state.conflicts;
        for (const field of Object.keys(after)) {
          const key = conflictKey({ table, id, field });
          conflicts = conflicts.filter((c) => conflictKey(c) !== key);
          if (!(field in theirs)) continue;
          if (isProvenanceField(field) && !valueClashed.has(field)) adopt[field] = theirs[field]!;
          else conflicts = [...conflicts, { table, id, field, mine: after[field]!, theirs: theirs[field]! }];
        }
        this.set({ conflicts });
        if (Object.keys(adopt).length) this.applyLocal({ kind: "update", changes: [{ table, id, before: {}, after: adopt }] });
        // Fields not written (in conflict, or adopted) will have no echo.
        return saved(new Set(Object.keys(theirs)));
      }
      this.set({ error: `${r.status === "not_found" ? GONE : r.message} ${ROLLED_BACK}` });
      return failed;
    } catch {
      this.set({ error: SAVE_FAILED });
      return failed;
    }
  }

  private applyLocal(op: Op): void {
    this.set({ bundle: applyOp(this.state.bundle, op) });
  }

  /** Show `value` for a conflict's field (not an edit: no history, no save). */
  private setField(c: Pick<Conflict, "table" | "id" | "field">, value: Value): void {
    const rows: readonly object[] = c.table === "steps" ? this.state.bundle.steps : this.state.bundle.edges;
    const row = rows.find((r) => (r as { id: string }).id === c.id);
    if (!row || readField(row, c.field) === value) return;
    this.applyLocal({ kind: "update", changes: [{ table: c.table, id: c.id, before: {}, after: { [c.field]: value } }] });
  }

  private emitRemote(applied: Applied[]): void {
    for (const listener of this.remoteListeners) listener(applied);
  }

  private dropConflict(conflict: Conflict): void {
    const key = conflictKey(conflict);
    this.set({ conflicts: this.state.conflicts.filter((c) => conflictKey(c) !== key) });
  }

  private syncHistory(): void {
    this.set({ undoLabel: this.undoStack.at(-1)?.label ?? null, redoLabel: this.redoStack.at(-1)?.label ?? null });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.inFlight++;
    this.set({ saving: true });
    const done = () => {
      this.inFlight--;
      if (!this.inFlight) this.set({ saving: false });
    };
    this.queue = this.queue.then(task).then(done, done);
    return this.queue;
  }

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
