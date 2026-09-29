// Input checks behind the issue Server Actions (app/w/[slug]/issue-actions.ts)
// and the in-memory demo store. They only reject malformed input early: the
// database checks every enumerated column again, and RLS decides who may write.

import type { IssueStatus } from "@transpera-flow/db";
import { ISSUE_SEVERITIES, ISSUE_TYPES, type IssueSeverity, type IssueType } from "@transpera-flow/engine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same shape as the table's check: <detector>:<subject kind>:<id>. */
const DETECTED_KEY = /^[a-z_]+:[a-z_]+:\S{1,200}$/;

export const ISSUE_STATUSES = ["open", "in_progress", "done", "dismissed"] as const satisfies readonly IssueStatus[];
export const MAX_TITLE = 200;
export const MAX_EVIDENCE = 5000;
const MAX_METRICS = 50;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const optionalId = (v: unknown) => v === undefined || v === null || isId(v);
const isType = (v: unknown): v is IssueType => (ISSUE_TYPES as readonly unknown[]).includes(v);
const isSeverity = (v: unknown): v is IssueSeverity => (ISSUE_SEVERITIES as readonly unknown[]).includes(v);
const isStatus = (v: unknown): v is IssueStatus => (ISSUE_STATUSES as readonly unknown[]).includes(v);
const isTitle = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.trim().length <= MAX_TITLE;
const isEvidence = (v: unknown) => v === null || (typeof v === "string" && v.length <= MAX_EVIDENCE);

/** Links an issue can carry (all optional). */
const LINKS = ["process_id", "step_id", "role_id", "person_id", "owner_person_id", "scenario_id"] as const;
type Links = Record<(typeof LINKS)[number], string | null>;

/** A manually logged issue: what the "Log an issue" form sends. */
export interface IssueInput extends Links {
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  evidence: string | null;
  status: IssueStatus;
}

/** A detection to track: the detected issue's fields and its key. */
export interface PromoteInput extends Links {
  detected_key: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  evidence: string | null;
  evidence_metrics: Record<string, number>;
}

const object = (input: unknown): Record<string, unknown> | null =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;

function links(o: Record<string, unknown>): Links | null {
  const out = {} as Links;
  for (const k of LINKS) {
    if (!optionalId(o[k])) return null;
    out[k] = (o[k] as string | null | undefined) ?? null;
  }
  return out;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseIssueInput(input: unknown): Parsed<IssueInput> {
  const o = object(input);
  if (!o) return { ok: false, error: "That issue isn't valid." };
  if (!isTitle(o.title)) return { ok: false, error: `Give the issue a title of up to ${MAX_TITLE} characters.` };
  if (!isType(o.type)) return { ok: false, error: "Pick a type." };
  if (!isSeverity(o.severity)) return { ok: false, error: "Pick a severity." };
  const status = o.status ?? "open";
  if (!isStatus(status)) return { ok: false, error: "Pick a status." };
  const evidence = o.evidence === undefined ? null : o.evidence;
  if (!isEvidence(evidence)) return { ok: false, error: `Keep the evidence to ${MAX_EVIDENCE} characters.` };
  const l = links(o);
  if (!l) return { ok: false, error: "That issue links to something that isn't valid." };
  return { ok: true, value: { ...l, type: o.type, severity: o.severity, title: o.title.trim(), evidence: text(evidence), status } };
}

export function parsePromoteInput(input: unknown): Parsed<PromoteInput> {
  const o = object(input);
  if (!o || typeof o.detected_key !== "string" || !DETECTED_KEY.test(o.detected_key)) return { ok: false, error: "That detected issue isn't valid." };
  const base = parseIssueInput({ ...o, status: "open", owner_person_id: o.owner_person_id ?? null });
  if (!base.ok) return base;
  const metrics = object(o.evidence_metrics ?? {});
  if (
    !metrics ||
    Object.keys(metrics).length > MAX_METRICS ||
    !Object.entries(metrics).every(([k, v]) => k.length <= 60 && typeof v === "number" && Number.isFinite(v))
  ) {
    return { ok: false, error: "That detected issue isn't valid." };
  }
  // A tracked detection always starts open.
  const rest: Partial<IssueInput> = { ...base.value };
  delete rest.status;
  return {
    ok: true,
    value: { ...(rest as Omit<IssueInput, "status">), detected_key: o.detected_key, evidence_metrics: metrics as Record<string, number> },
  };
}

/** Fields edited one at a time (save_fields), and what each accepts. */
export const ISSUE_FIELDS = {
  title: isTitle,
  type: isType,
  severity: isSeverity,
  status: isStatus,
  evidence: isEvidence,
  process_id: optionalId,
  step_id: optionalId,
  role_id: optionalId,
  person_id: optionalId,
  owner_person_id: optionalId,
  scenario_id: optionalId,
} as const satisfies Record<string, (v: unknown) => boolean>;

export type IssueField = keyof typeof ISSUE_FIELDS;
export type Scalar = string | number | boolean | null;

export const isIssueField = (f: unknown): f is IssueField => typeof f === "string" && Object.hasOwn(ISSUE_FIELDS, f);

/** A new value for one field, cleaned (titles trimmed, blank evidence as null), or null if invalid. */
export function cleanFieldValue(field: IssueField, value: unknown): { value: Scalar } | null {
  const v = typeof value === "string" ? (field === "title" ? value.trim() : value.trim() || null) : value;
  if (v !== null && typeof v !== "string") return null;
  return (ISSUE_FIELDS[field] as (x: unknown) => boolean)(v) ? { value: v } : null;
}
