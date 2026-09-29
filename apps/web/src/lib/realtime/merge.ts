// Merging other people's saved changes into the editor's copy of the process
// (issue #10, docs/adr/0005-realtime-presence-and-live-changes.md).
// Framework-free and synchronous: the editor owns one and feeds it both its
// own saves (begin / end) and what Realtime reports (merge).
//
// Realtime delivers changes in commit order, and our own saves come back too
// (Postgres Changes has no "not from me" filter). So each save of ours leaves
// an expected echo per field, from the moment it is queued:
// - A change whose value for that field is the oldest expected echo is the
//   echo: consumed, and the field keeps what we show (ours, or newer).
// - Any other value for that field while an echo is still expected was
//   committed before our save, so it is stale for that field and skipped
//   (if our save then fails, the latest such value is shown after all).
// - Fields with no expected echo take the stored value, unless they are in
//   conflict: then "theirs" is updated, or the conflict dropped when the
//   stored value now matches ours. The editor's copy is the base every later
//   compare-and-set is checked against, so this also updates the base.
// Rows work the same way: a remote insert of a row we are removing (or a
// delete of one we are inserting) that arrives before our echo is stale.
// Remote changes never touch the undo history: they aren't the user's edits.
// A reload (`authoritative`) trusts the stored rows over expected echoes.

import type { EdgeRow, ProcessBundle, StepRow } from "@transpera-flow/db";
import { sameScalar } from "@/lib/editor/commands";
import { applyOp, readField, writeFields, type Patch, type SaveUnit, type Scalar, type Table } from "@/lib/editor/ops";
import { EDGE_FIELDS, STEP_FIELDS } from "@/lib/editor/validate";
import type { RemoteChange } from "./rows";

/** Fields compared per table: everything the editor edits (jsonb params by key). */
export const MERGED_FIELDS: Record<Table, readonly string[]> = { steps: Object.keys(STEP_FIELDS), edges: Object.keys(EDGE_FIELDS) };

/** A same-field conflict as the merger sees it. */
export interface FieldConflict {
  table: Table;
  id: string;
  field: string;
  mine: Scalar;
  theirs: Scalar;
}

/** What a remote change did to the editor's copy, for "Tom changed …" notes. */
export interface Applied {
  table: Table;
  id: string;
  kind: "added" | "removed" | "changed";
  /** Changed fields and their new values (empty for added / removed). */
  values: Patch;
}

export type UnitOutcome = { kind: "saved"; conflicted: ReadonlySet<string> } | { kind: "failed" };

/** Stored values to show after a failed save of ours (they were skipped while it was pending). */
export interface LatePatch {
  table: Table;
  id: string;
  values: Patch;
}

/** After this long an expected echo is given up on (a lost message; a reload catches up). */
const ECHO_MS = 30_000;

interface FieldEcho {
  unit: SaveUnit;
  value: Scalar;
  at: number;
}

interface RowEcho {
  unit: SaveUnit;
  op: "insert" | "remove";
  at: number;
}

const fieldKey = (table: Table, id: string, field: string) => `${table}:${id}:${field}`;
const rowKey = (table: Table, id: string) => `${table}:${id}`;

export class RemoteChangeMerger {
  private fieldEchoes = new Map<string, FieldEcho[]>();
  private rowEchoes = new Map<string, RowEcho[]>();
  /** The latest value skipped as stale per field, in case our save fails after all. */
  private skipped = new Map<string, Scalar>();
  /** Saves of ours queued or running. */
  private inFlight = new Set<SaveUnit>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A save of ours is queued: expect its echo. */
  begin(unit: SaveUnit): void {
    const at = this.now();
    this.inFlight.add(unit);
    if (unit.kind === "update") {
      const { table, id, after } = unit.change;
      for (const [f, value] of Object.entries(after)) push(this.fieldEchoes, fieldKey(table, id, f), { unit, value, at });
      return;
    }
    for (const [table, rows] of [["steps", unit.steps], ["edges", unit.edges]] as const) {
      for (const r of rows) push(this.rowEchoes, rowKey(table, r.id), { unit, op: unit.kind, at });
    }
  }

  /**
   * A save of ours ended (after any rollback). Writes that didn't happen
   * (failed, or fields in conflict) will have no echo. After a failure,
   * returns stored values skipped meanwhile, to show now.
   */
  end(unit: SaveUnit, outcome: UnitOutcome): LatePatch | null {
    this.inFlight.delete(unit);
    if (unit.kind !== "update") {
      if (outcome.kind === "failed") {
        for (const [table, rows] of [["steps", unit.steps], ["edges", unit.edges]] as const) {
          for (const r of rows) drop(this.rowEchoes, rowKey(table, r.id), (e) => e.unit === unit);
        }
      }
      return null;
    }
    const { table, id, after } = unit.change;
    const values: Patch = {};
    for (const f of Object.keys(after)) {
      const k = fieldKey(table, id, f);
      const conflicted = outcome.kind === "saved" && outcome.conflicted.has(f);
      if (outcome.kind === "saved" && !conflicted) continue;
      drop(this.fieldEchoes, k, (e) => e.unit === unit);
      if (this.fieldEchoes.has(k)) continue;
      const seen = this.skipped.get(k);
      this.skipped.delete(k);
      // A conflict already told us what is stored.
      if (!conflicted && seen !== undefined) values[f] = seen;
    }
    return Object.keys(values).length ? { table, id, values } : null;
  }

  /**
   * Apply one remote change. `authoritative` (a full reload) trusts every
   * value as stored now, rather than waiting for echoes of our saves.
   */
  merge<C extends FieldConflict>(
    bundle: ProcessBundle,
    conflicts: C[],
    change: RemoteChange,
    authoritative = false,
  ): { bundle: ProcessBundle; conflicts: C[]; applied: Applied | null } {
    const { table } = change;
    const id = change.kind === "delete" ? change.id : change.row.id;
    const rows: readonly (StepRow | EdgeRow)[] = table === "steps" ? bundle.steps : bundle.edges;
    const unchanged = { bundle, conflicts, applied: null };
    const local = rows.find((r) => r.id === id);

    // Our own insert or remove of this row is still to echo.
    const rk = rowKey(table, id);
    const rowEchoes = this.fresh(this.rowEchoes, rk);
    if (authoritative && rowEchoes.length) {
      // A reload: while our save is in flight, it decides; once it has ended, the stored row is the truth.
      if (rowEchoes.some((e) => this.inFlight.has(e.unit))) return unchanged;
      this.rowEchoes.delete(rk);
    } else if (rowEchoes.length) {
      const echo = (change.kind === "delete") === (rowEchoes[0]!.op === "remove");
      if (!echo) return unchanged; // Committed before ours.
      rowEchoes.shift();
      if (!rowEchoes.length) this.rowEchoes.delete(rk);
    }

    if (change.kind === "delete") {
      if (!local) return unchanged;
      const next = applyOp(bundle, table === "steps" ? { kind: "remove", steps: [local as StepRow], edges: [] } : { kind: "remove", steps: [], edges: [local as EdgeRow] });
      const edges = new Set(next.edges.map((e) => e.id));
      const kept = conflicts.filter((c) => (c.table === "steps" ? c.id !== id : edges.has(c.id)));
      return { bundle: next, conflicts: kept, applied: { table, id, kind: "removed", values: {} } };
    }

    if (!local) {
      if (change.table === "edges") {
        // Its steps may be ones we are removing; the edge would point at nothing.
        const steps = new Set(bundle.steps.map((s) => s.id));
        if (!steps.has(change.row.from_step_id) || !steps.has(change.row.to_step_id)) return unchanged;
        return { bundle: { ...bundle, edges: [...bundle.edges, change.row] }, conflicts, applied: { table, id, kind: "added", values: {} } };
      }
      return { bundle: { ...bundle, steps: [...bundle.steps, change.row] }, conflicts, applied: { table, id, kind: "added", values: {} } };
    }

    let nextConflicts = conflicts;
    const values: Patch = {};
    for (const f of MERGED_FIELDS[table]) {
      const k = fieldKey(table, id, f);
      const theirs = readField(change.row, f);
      const echoes = this.fresh(this.fieldEchoes, k);
      if (authoritative && echoes.length) {
        // A reload: while we are saving the field, the save decides; once saved, the stored value is the truth.
        if (echoes.some((e) => this.inFlight.has(e.unit))) continue;
        this.fieldEchoes.delete(k);
        this.skipped.delete(k);
      } else if (echoes.length) {
        if (sameScalar(echoes[0]!.value, theirs)) {
          echoes.shift();
          if (!echoes.length) this.fieldEchoes.delete(k);
          this.skipped.delete(k);
        } else {
          this.skipped.set(k, theirs);
        }
        continue;
      }
      const conflict = nextConflicts.find((c) => c.table === table && c.id === id && c.field === f);
      if (conflict) {
        if (sameScalar(theirs, conflict.mine)) nextConflicts = nextConflicts.filter((c) => c !== conflict);
        else if (!sameScalar(theirs, conflict.theirs)) nextConflicts = nextConflicts.map((c) => (c === conflict ? { ...c, theirs } : c));
        continue;
      }
      if (!sameScalar(theirs, readField(local, f))) values[f] = theirs;
    }
    if (!Object.keys(values).length) return { bundle, conflicts: nextConflicts, applied: null };
    const next =
      table === "steps"
        ? { ...bundle, steps: bundle.steps.map((s) => (s.id === id ? writeFields(s, values) : s)) }
        : { ...bundle, edges: bundle.edges.map((e) => (e.id === id ? writeFields(e, values) : e)) };
    return { bundle: next, conflicts: nextConflicts, applied: { table, id, kind: "changed", values } };
  }

  /** Forget everything: the editor started over. */
  reset(): void {
    this.fieldEchoes.clear();
    this.rowEchoes.clear();
    this.skipped.clear();
    this.inFlight.clear();
  }

  /** The echoes still expected for a key, oldest first, dropping ones given up on. */
  private fresh<E extends { at: number }>(map: Map<string, E[]>, key: string): E[] {
    const list = map.get(key);
    if (!list) return [];
    const cutoff = this.now() - ECHO_MS;
    while (list.length && list[0]!.at < cutoff) list.shift();
    if (!list.length) map.delete(key);
    return list;
  }
}

function push<E>(map: Map<string, E[]>, key: string, entry: E): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function drop<E>(map: Map<string, E[]>, key: string, match: (e: E) => boolean): void {
  const list = map.get(key);
  if (!list) return;
  const kept = list.filter((e) => !match(e));
  if (kept.length) map.set(key, kept);
  else map.delete(key);
}
