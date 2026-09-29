// Where a step's parameters came from (docs/PRD.md §3 "Parameter provenance",
// §5 `provenance jsonb`). A step's `provenance` holds one entry per value
// column: `{current_wip: {source: "entered", at, by}, ...}`. When a person
// changes a parameter in the editor, the same edit (and so the same per-field
// save and the same undo step) records it as `entered` through the
// `provenance.<column>` key. A value with no entry is an estimate.

import type { ProcessBundle, StepRow } from "@transpera-flow/db";
import { readField, type Edit, type Patch, type RowChange } from "./ops";

export type ProvenanceSource = "estimated" | "entered" | "measured";

/** One value's provenance (the §5 shape). A type alias so it stays a plain JSON object. */
export type Provenance = {
  source: ProvenanceSource;
  /** When it was set (ISO timestamp). */
  at?: string;
  /** User who set it. */
  by?: string;
  [key: string]: unknown;
};

/** Step columns that are simulation parameters, and so carry provenance. */
export const PROVENANCE_COLUMNS = [
  "work_hours",
  "work_dist",
  "work_params",
  "wait_hours",
  "wait_dist",
  "wait_params",
  "rework_rate",
  "sla_hours",
  "current_wip",
] as const;

const TRACKED = new Set<string>(PROVENANCE_COLUMNS);
const PREFIX = "provenance.";

/** The column part of a field (`work_params.cv` → `work_params`). */
const columnOf = (field: string) => field.split(".", 1)[0]!;

export const isProvenanceField = (field: string): boolean => field.startsWith(PREFIX);

/** The provenance field recording where `field`'s value came from, if it has one. */
export function provenanceFieldFor(field: string): string | null {
  const col = columnOf(field);
  return TRACKED.has(col) && !isProvenanceField(field) ? `${PREFIX}${col}` : null;
}

/** A step's provenance entry for `column`, if one is recorded. */
export function stepProvenance(step: StepRow, column: string): Provenance | null {
  const map = (step as StepRow & { provenance?: unknown }).provenance;
  const entry = map && typeof map === "object" ? (map as Record<string, unknown>)[column] : null;
  return entry && typeof entry === "object" && typeof (entry as Provenance).source === "string" ? (entry as Provenance) : null;
}

/** Where a step's value came from; a value with none recorded is an estimate. */
export function provenanceSource(step: StepRow, column: string): ProvenanceSource {
  const source = stepProvenance(step, column)?.source;
  return source === "entered" || source === "measured" ? source : "estimated";
}

/** Who and when to record for a person's edit. */
export interface Stamp {
  at: string;
  by?: string | null;
}

/**
 * The edit with each step parameter it changes recorded as `entered`: its
 * `provenance.<column>` goes from what the step had to `{source: "entered", at, by}`
 * in the same row change, so it saves (compare-and-set) and undoes with the value.
 */
export function stampProvenance(bundle: ProcessBundle, edit: Edit, stamp: Stamp): Edit {
  const entry: Provenance = { source: "entered", at: stamp.at, ...(stamp.by ? { by: stamp.by } : {}) };
  let changed = false;
  const ops = edit.ops.map((op) => {
    if (op.kind !== "update") return op;
    const changes = op.changes.map((c): RowChange => {
      if (c.table !== "steps") return c;
      const row = bundle.steps.find((s) => s.id === c.id);
      if (!row) return c;
      const before: Patch = { ...c.before };
      const after: Patch = { ...c.after };
      for (const field of Object.keys(c.after)) {
        const key = provenanceFieldFor(field);
        if (!key || key in after) continue;
        before[key] = readField(row, key);
        after[key] = entry;
        changed = true;
      }
      return { ...c, before, after };
    });
    return { ...op, changes };
  });
  return changed ? { ...edit, ops } : edit;
}
