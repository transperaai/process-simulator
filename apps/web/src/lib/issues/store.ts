// Where tracked issues go. `live` (./live-store.ts) calls Server Actions that
// write to the database as the signed-in user; `MemoryIssueStore` keeps them
// in memory for the public demo (lost on reload) and for tests.

import type { IssueRow } from "@transpera-flow/db";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { cleanFieldValue, isIssueField, parseIssueInput, parsePromoteInput, type IssueField, type IssueInput, type PromoteInput, type Scalar } from "./validate";

export type SaveIssueResult = { status: "ok"; issue: IssueRow } | { status: "error"; message: string };
export type RemoveIssueResult = { status: "ok" } | { status: "error"; message: string };

export const ALREADY_TRACKED = "That issue is already tracked.";

export interface IssueStore {
  /** Log an issue by hand. */
  create(input: IssueInput): Promise<SaveIssueResult>;
  /** Track a detected issue: stored with `source: promoted` and its key, once per key. */
  promote(input: PromoteInput): Promise<SaveIssueResult>;
  /** Save one field if its stored value is still `base` (per-field saves). */
  saveField(id: string, field: IssueField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>>;
  remove(id: string): Promise<RemoveIssueResult>;
}

export class MemoryIssueStore implements IssueStore {
  private rows: Map<string, IssueRow>;

  constructor(
    private readonly workspaceId: string,
    initial: readonly IssueRow[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.rows = new Map(initial.map((r) => [r.id, r]));
  }

  private insert(fields: Omit<IssueRow, "id" | "workspace_id" | "created_at" | "updated_at" | "resolved_at">): IssueRow {
    const at = this.now();
    const row: IssueRow = {
      ...fields,
      id: crypto.randomUUID(),
      workspace_id: this.workspaceId,
      resolved_at: fields.status === "done" || fields.status === "dismissed" ? at : null,
      created_at: at,
      updated_at: at,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async create(input: IssueInput): Promise<SaveIssueResult> {
    const parsed = parseIssueInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    return { status: "ok", issue: this.insert({ ...parsed.value, evidence_metrics: {}, source: "manual", detected_key: null }) };
  }

  async promote(input: PromoteInput): Promise<SaveIssueResult> {
    const parsed = parsePromoteInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    if ([...this.rows.values()].some((r) => r.detected_key === parsed.value.detected_key)) return { status: "error", message: ALREADY_TRACKED };
    return { status: "ok", issue: this.insert({ ...parsed.value, status: "open", source: "promoted" }) };
  }

  async saveField(id: string, field: IssueField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
    const row = this.rows.get(id);
    if (!row) return { status: "not_found" };
    const clean = isIssueField(field) ? cleanFieldValue(field, value) : null;
    if (!clean) return { status: "error", message: "That value isn't valid." };
    const stored = row[field] as Scalar;
    if (stored !== base && stored !== clean.value) return { status: "conflict", theirs: stored };
    const at = this.now();
    const next = { ...row, [field]: clean.value, updated_at: at } as IssueRow;
    if (field === "status") {
      const closed = (s: string) => s === "done" || s === "dismissed";
      next.resolved_at = closed(next.status) ? (closed(row.status) ? row.resolved_at : at) : null;
    }
    this.rows.set(id, next);
    return { status: "saved", value: clean.value };
  }

  async remove(id: string): Promise<RemoveIssueResult> {
    this.rows.delete(id);
    return { status: "ok" };
  }
}
