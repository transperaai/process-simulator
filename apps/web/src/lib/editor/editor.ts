// The process editor's state (issue #8): the process as the editor shows it,
// undo and redo, saving, and same-field conflicts. Framework-free so it can be
// unit tested; `useDraftSession` (lib/drafts) wraps it for React.
//
// Edits apply to the local copy at once (optimistic) and are saved in order,
// one at a time, so each save's `base` is what the previous one stored. Undo
// applies an edit's inverse and saves it like any other edit. A same-field
// conflict keeps our value on screen and waits for "keep mine" / "keep
// theirs"; a failed save rolls back what didn't save.

import type { ProcessBundle } from "@transpera-flow/db";
import { applyOp, invertEdit, invertOp, type Edit, type Op, type Patch, type RowChange, type Table, type Value } from "./ops";
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

export const SAVE_FAILED = "Couldn't save that change, so it was rolled back. Check your connection and try again.";
export const GONE = "That item was removed by someone else, or you don't have permission to edit it.";
const ROLLED_BACK = "The change was rolled back.";

/** One unit of saving: an insert, a remove, or one row's fields. */
type Unit = Exclude<Op, { kind: "update" }> | { kind: "update"; change: RowChange };

function units(edit: Edit): Unit[] {
  return edit.ops.flatMap((op): Unit[] => (op.kind === "update" ? op.changes.map((change) => ({ kind: "update", change })) : [op]));
}

const unitOp = (u: Unit): Op => (u.kind === "update" ? { kind: "update", changes: [u.change] } : u);
const conflictKey = (c: Pick<Conflict, "table" | "id" | "field">) => `${c.table}:${c.id}:${c.field}`;

export class ProcessEditor {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private inFlight = 0;

  constructor(
    bundle: ProcessBundle,
    private readonly store: ProcessStore,
    /** Who is editing, and when: step parameters they change are recorded as entered (./provenance.ts). */
    private readonly stamp?: () => Stamp,
  ) {
    this.state = { bundle, undoLabel: null, redoLabel: null, saving: false, conflicts: [], error: null };
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
    const change: RowChange = {
      table: conflict.table,
      id: conflict.id,
      before: Object.fromEntries(all.map((c) => [c.field, c.theirs])),
      after: Object.fromEntries(all.map((c) => [c.field, c.mine])),
    };
    return this.enqueue(async () => {
      await this.save({ kind: "update", change });
    });
  }

  /** Take the stored value (and its provenance). Not an edit of ours, so it isn't undoable. */
  keepTheirs(conflict: Conflict): void {
    const all = this.withCompanion(conflict);
    all.forEach((c) => this.dropConflict(c));
    this.applyLocal({
      kind: "update",
      changes: [{ table: conflict.table, id: conflict.id, before: {}, after: Object.fromEntries(all.map((c) => [c.field, c.theirs])) }],
    });
  }

  /** A conflict, plus the conflict on its value's provenance, which is settled with it and never shown. */
  private withCompanion(conflict: Conflict): Conflict[] {
    const key = provenanceFieldFor(conflict.field);
    const companion = key && this.state.conflicts.find((c) => c.table === conflict.table && c.id === conflict.id && c.field === key);
    return companion ? [conflict, companion] : [conflict];
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
    const list = units(edit);
    void this.enqueue(async () => {
      for (let i = 0; i < list.length; i++) {
        if (await this.save(list[i]!)) continue;
        // Roll back what didn't save, newest first. A failed edit leaves
        // history; after a failed undo the edit stays where undo can retry it.
        for (let j = list.length - 1; j >= i; j--) this.applyLocal(invertOp(unitOp(list[j]!)));
        this.undoStack = this.undoStack.filter((e) => e !== origin);
        this.redoStack = this.redoStack.filter((e) => e !== origin);
        if (mode === "undo") this.undoStack.push(origin);
        this.syncHistory();
        return;
      }
    });
  }

  /** Save one unit. False if it failed; a conflict counts as saved, pending the user's choice. */
  private async save(unit: Unit): Promise<boolean> {
    try {
      if (unit.kind === "insert" || unit.kind === "remove") {
        const r =
          unit.kind === "insert"
            ? await this.store.insert(unit.steps, unit.edges)
            : await this.store.remove(
                unit.steps.map((s) => s.id),
                unit.edges.map((e) => e.id),
              );
        if (r.status === "ok") return true;
        this.set({ error: `${r.message} ${ROLLED_BACK}` });
        return false;
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
        return true;
      }
      this.set({ error: `${r.status === "not_found" ? GONE : r.message} ${ROLLED_BACK}` });
      return false;
    } catch {
      this.set({ error: SAVE_FAILED });
      return false;
    }
  }

  private applyLocal(op: Op): void {
    this.set({ bundle: applyOp(this.state.bundle, op) });
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
