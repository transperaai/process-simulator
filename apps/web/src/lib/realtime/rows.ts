// Rows as Realtime (or the demo) reports them, turned into the editor's row
// types. Postgres Changes sends the whole row as JSON: columns the editor
// doesn't use (created_at, …) are dropped, a step's provenance is kept, and
// numeric columns, which can arrive as strings, become numbers. Pure.

import type { DistParams, EdgeRow, StepRow } from "@transpera-flow/db";
import type { Table } from "@/lib/editor/ops";

/** A change someone saved to a step or edge of the revision being edited. */
export type RemoteChange =
  /** Inserted or updated: the whole row as stored now. */
  | { kind: "upsert"; table: "steps"; row: StepRow }
  | { kind: "upsert"; table: "edges"; row: EdgeRow }
  | { kind: "delete"; table: Table; id: string };

type Json = Record<string, unknown>;

const STEP_NUMBERS = ["work_hours", "wait_hours", "rework_rate", "x", "y"] as const;
const STEP_OPTIONAL_NUMBERS = ["sla_hours", "expected_wait_hours", "lost_per_day_waiting", "dropoff_benchmark", "target_cycle_hours", "current_wip"] as const;
const STEP_TEXT = ["name", "kind", "work_dist", "wait_dist"] as const;
// Where a step sits in a group, a group's first step and the child process a step holds (issue #102) come along too.
const STEP_OPTIONAL_TEXT = ["outcome", "role_id", "person_id", "rework_to_step_id", "tool", "notes", "parent_step_id", "entry_step_id", "child_process_id"] as const;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function params(v: unknown): DistParams {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: DistParams = {};
  for (const key of ["cv", "min", "mode", "max"] as const) {
    if (key in v) out[key] = num((v as Json)[key]);
  }
  return out;
}

/** The ids every row carries, or null if the record isn't a row of ours. */
function keys(record: Json): Pick<StepRow, "id" | "revision_id" | "workspace_id" | "process_id"> | null {
  const [id, revision_id, workspace_id, process_id] = [record.id, record.revision_id, record.workspace_id, record.process_id].map(str);
  return id && revision_id && workspace_id && process_id ? { id, revision_id, workspace_id, process_id } : null;
}

export function stepFromRecord(record: Json): StepRow | null {
  const k = keys(record);
  if (!k) return null;
  const row: Json = {
    ...k,
    work_params: params(record.work_params),
    wait_params: params(record.wait_params),
    assumption: record.assumption === true,
    conflict: record.conflict === true,
  };
  // Where each parameter came from (lib/editor/provenance.ts): merged with the values it describes.
  const provenance = record.provenance;
  if (provenance && typeof provenance === "object" && !Array.isArray(provenance)) row.provenance = provenance;
  for (const f of STEP_NUMBERS) {
    const v = num(record[f]);
    if (v === null) return null;
    row[f] = v;
  }
  for (const f of STEP_OPTIONAL_NUMBERS) row[f] = num(record[f]);
  for (const f of STEP_TEXT) {
    const v = str(record[f]);
    if (v === null) return null;
    row[f] = v;
  }
  for (const f of STEP_OPTIONAL_TEXT) row[f] = str(record[f]);
  // A split or replaced step (issue #16): kept so the editor files it with the retired rows.
  const replacedBy = Array.isArray(record.replaced_by) ? record.replaced_by.filter((v): v is string => typeof v === "string") : [];
  if (replacedBy.length) row.replaced_by = replacedBy;
  return row as unknown as StepRow;
}

export function edgeFromRecord(record: Json): EdgeRow | null {
  const k = keys(record);
  const from = str(record.from_step_id);
  const to = str(record.to_step_id);
  const probability = num(record.probability);
  if (!k || !from || !to || probability === null) return null;
  return { ...k, from_step_id: from, to_step_id: to, probability, condition_tag: str(record.condition_tag), label: str(record.label) };
}

/** A Postgres Changes payload for steps or edges as a change, or null if it isn't one we can use. */
export function changeFromPayload(payload: { table: string; eventType: string; new: Json; old: Json }): (RemoteChange & { revisionId: string }) | null {
  const table = payload.table;
  if (table !== "steps" && table !== "edges") return null;
  if (payload.eventType === "DELETE") {
    // Deletes carry the primary key, (revision_id, id).
    const id = str(payload.old.id);
    const revisionId = str(payload.old.revision_id);
    return id && revisionId ? { kind: "delete", table, id, revisionId } : null;
  }
  if (table === "steps") {
    const row = stepFromRecord(payload.new);
    return row ? { kind: "upsert", table, row, revisionId: row.revision_id } : null;
  }
  const row = edgeFromRecord(payload.new);
  return row ? { kind: "upsert", table, row, revisionId: row.revision_id } : null;
}
