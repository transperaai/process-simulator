// Where sources go. `live` (./live-store.ts) calls Server Actions that write
// to the database as the signed-in user; `MemorySourceStore` keeps them in
// memory for the public demo (lost on reload) and for tests.

import type { SourceRow } from "@transpera-flow/db";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { cleanSourceField, formatSpeakers, isSourceField, parseSourceInput, type Scalar, type SourceField, type SourceInput } from "./validate";

export type SaveSourceResult = { status: "ok"; source: SourceRow } | { status: "error"; message: string };
export type RemoveSourceResult = { status: "ok" } | { status: "error"; message: string };

export interface SourceStore {
  create(input: SourceInput): Promise<SaveSourceResult>;
  /** Save one field if its stored value is still `base` (per-field saves). Speakers travel as "a, b" text. */
  saveField(id: string, field: SourceField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>>;
  remove(id: string): Promise<RemoveSourceResult>;
}

/** A field as the form shows it: speakers as "a, b". */
export const sourceFieldValue = (row: SourceRow, field: SourceField): Scalar =>
  field === "speakers" ? formatSpeakers(row.speakers) || null : (row[field] ?? null);

export class MemorySourceStore implements SourceStore {
  private rows: Map<string, SourceRow>;

  constructor(
    private readonly workspaceId: string,
    initial: readonly SourceRow[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.rows = new Map(initial.map((r) => [r.id, r]));
  }

  async create(input: SourceInput): Promise<SaveSourceResult> {
    const parsed = parseSourceInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    const at = this.now();
    const row: SourceRow = { ...parsed.value, id: crypto.randomUUID(), workspace_id: this.workspaceId, created_at: at, updated_at: at };
    this.rows.set(row.id, row);
    return { status: "ok", source: row };
  }

  async saveField(id: string, field: SourceField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
    const row = this.rows.get(id);
    if (!row) return { status: "not_found" };
    const clean = isSourceField(field) ? cleanSourceField(field, value) : null;
    if (!clean) return { status: "error", message: "That value isn't valid." };
    const stored = sourceFieldValue(row, field);
    const next = { ...row, [field]: clean.value, updated_at: this.now() } as SourceRow;
    const shown = sourceFieldValue(next, field);
    if (stored !== base && stored !== shown) return { status: "conflict", theirs: stored };
    this.rows.set(id, next);
    return { status: "saved", value: shown };
  }

  async remove(id: string): Promise<RemoveSourceResult> {
    this.rows.delete(id);
    return { status: "ok" };
  }
}
