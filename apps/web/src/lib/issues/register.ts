// The issues register in the browser (issue #17): tracked issues from the
// database merged with the issues the latest run detected, filters, the fix
// each one links to, and the badges on the map. Pure functions; the
// components render the results.

import type { IssueRow, IssueSource, IssueStatus, ScenarioRow } from "@transpera-flow/db";
import {
  RATINGS,
  RATING_LABELS,
  ratingRank,
  compareRatingsDesc,
  ratingOfStored,
  storedOfRating,
  type DetectedIssue,
  type IssueType,
  type Rating,
  type ScenarioPatch,
} from "@transpera-flow/engine";
import type { PromoteInput } from "./validate";

export type RegisterEntry =
  /** A stored issue; `detection` is what the latest run detected for its key, if it still does. */
  | { kind: "tracked"; issue: IssueRow; detection: DetectedIssue | null }
  /** Detected by the latest run and not tracked yet: read-only, regenerated each run. */
  | { kind: "detected"; detection: DetectedIssue };

export const TYPE_LABELS: Record<IssueType, string> = {
  bottleneck: "Bottleneck",
  spof: "Single point of failure",
  manual: "Manual work",
  delay: "Delay",
  failure: "Failure / rework",
  idea: "Idea",
  capacity: "Capacity",
  sla: "SLA",
  churn_risk: "Churn risk",
  perception_gap: "Perception gap",
  broken_scenario: "Broken scenario",
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

/** The four ratings, most severe first: the order the register, filters and reports list them in. */
export const RATINGS_WORST_FIRST: readonly Rating[] = [...RATINGS].reverse();

export const SOURCE_LABELS: Record<IssueSource, string> = {
  manual: "Audit finding",
  detected: "Detected",
  promoted: "Tracked detection",
};

const isOpen = (s: IssueStatus) => s === "open" || s === "in_progress";

/** An entry's shared fields, whichever kind it is. */
export function entryView(e: RegisterEntry) {
  if (e.kind === "detected") {
    const d = e.detection;
    return {
      id: d.key,
      title: d.title,
      evidence: d.evidence,
      type: d.type,
      rating: d.rating,
      source: "detected" as IssueSource,
      status: null,
      stepId: d.stepId,
      personId: d.personId,
      processId: null as string | null,
      open: true,
    };
  }
  const i = e.issue;
  return {
    id: i.id,
    title: i.title,
    evidence: i.evidence,
    type: i.type,
    // Stored issues keep the database's four values; they stand for the four ratings one to one.
    rating: ratingOfStored(i.severity),
    source: i.source,
    status: i.status,
    stepId: i.step_id,
    personId: i.person_id,
    processId: i.process_id,
    // Marked done but detected again: back on the list.
    open: isOpen(i.status) || (i.status === "done" && e.detection !== null),
  };
}

/**
 * Tracked issues and this run's detections in one list. A detection whose key
 * a tracked issue carries shows once, as that tracked issue. Open issues come
 * first, most severe first; closed ones last, most recently changed first.
 */
export function registerEntries(tracked: readonly IssueRow[], detected: readonly DetectedIssue[]): RegisterEntry[] {
  const byKey = new Map(detected.map((d) => [d.key, d]));
  const trackedKeys = new Set(tracked.flatMap((i) => (i.detected_key ? [i.detected_key] : [])));
  const entries: RegisterEntry[] = [
    ...tracked.map((issue): RegisterEntry => ({ kind: "tracked", issue, detection: issue.detected_key ? (byKey.get(issue.detected_key) ?? null) : null })),
    ...detected.filter((d) => !trackedKeys.has(d.key)).map((detection): RegisterEntry => ({ kind: "detected", detection })),
  ];
  const updated = (e: RegisterEntry) => (e.kind === "tracked" ? e.issue.updated_at : "");
  // Stable sort: equal entries keep tracked-then-detected, each in its own order.
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const oa = entryView(a.e).open;
      const ob = entryView(b.e).open;
      if (oa !== ob) return oa ? -1 : 1;
      if (!oa) return updated(b.e).localeCompare(updated(a.e)) || a.i - b.i;
      return compareRatingsDesc(entryView(a.e).rating, entryView(b.e).rating) || a.i - b.i;
    })
    .map(({ e }) => e);
}

export interface IssueFilters {
  /** A process id; detected issues belong to the process that was run. */
  process: string;
  /** A person id: the issue is about them or they own it. */
  person: string;
  rating: Rating | "";
  source: IssueSource | "";
  /** "active": open, in progress, or detected; "" for everything. */
  status: IssueStatus | "active" | "";
  /** A step id, e.g. from clicking a badge on the map. */
  step: string;
}

export const NO_FILTERS: IssueFilters = { process: "", person: "", rating: "", source: "", status: "active", step: "" };

/** The entries that pass every filter. `processId` is the process the detections came from. */
export function filterEntries(entries: readonly RegisterEntry[], f: IssueFilters, processId: string | null): RegisterEntry[] {
  return entries.filter((e) => {
    const v = entryView(e);
    if (f.process && (e.kind === "detected" ? processId : v.processId) !== f.process) return false;
    if (f.person && v.personId !== f.person && !(e.kind === "tracked" && e.issue.owner_person_id === f.person)) return false;
    if (f.rating && v.rating !== f.rating) return false;
    if (f.source && v.source !== f.source) return false;
    if (f.status === "active" && !v.open) return false;
    if (f.status && f.status !== "active" && v.status !== f.status) return false;
    if (f.step && v.stepId !== f.step) return false;
    return true;
  });
}

/** A fix an issue links to: a saved scenario, or a detection's suggested patches. */
export interface IssueFix {
  name: string;
  /** A saved scenario; null for a detection's suggestion. */
  scenarioId: string | null;
  patch: ScenarioPatch[];
}

/**
 * The fix an entry links to: its saved scenario if it has one that still
 * exists, otherwise the suggestion of its current detection, otherwise none.
 */
export function fixFor(e: RegisterEntry, scenarios: readonly ScenarioRow[]): IssueFix | null {
  if (e.kind === "tracked" && e.issue.scenario_id) {
    const s = scenarios.find((x) => x.id === e.issue.scenario_id);
    if (s) return { name: s.name, scenarioId: s.id, patch: s.patch };
  }
  const fix = e.detection?.fix;
  if (!fix) return null;
  const saved = matchingScenario(fix.patch, scenarios);
  return saved ? { name: saved.name, scenarioId: saved.id, patch: saved.patch } : { name: fix.name, scenarioId: null, patch: fix.patch };
}

/** A saved scenario with exactly these patches, if there is one ("Hire a strategist" for a hire fix). */
export function matchingScenario(patch: readonly ScenarioPatch[], scenarios: readonly ScenarioRow[]): ScenarioRow | null {
  const key = (p: readonly ScenarioPatch[]) => JSON.stringify(p.map(({ path, op, value }) => [path, op, value]));
  const k = key(patch);
  return scenarios.find((s) => key(s.patch) === k) ?? null;
}

/** What promoting a detection stores: its fields, its key, and its fix if a saved scenario matches it. */
export function promoteInput(d: DetectedIssue, processId: string | null, scenarios: readonly ScenarioRow[]): PromoteInput {
  return {
    detected_key: d.key,
    type: d.type,
    severity: storedOfRating(d.rating),
    title: d.title,
    evidence: d.evidence,
    evidence_metrics: d.metrics,
    process_id: processId,
    step_id: d.stepId,
    role_id: d.roleId,
    person_id: d.personId,
    owner_person_id: null,
    // A broken-scenario issue links the scenario it is about (issue #16).
    scenario_id: d.scenarioId ?? (d.fix ? (matchingScenario(d.fix.patch, scenarios)?.id ?? null) : null),
    // A churn risk links the client it is about (issue #19).
    ...(d.clientId ? { client_id: d.clientId } : {}),
  };
}

export interface StepBadge {
  count: number;
  /** The worst rating among them. */
  rating: Rating;
  titles: string[];
}

/**
 * A step's rating on the map, from its open issues: the worst of them, as a rank
 * (higher is worse) with its label, or null for a step with none. A closed group
 * takes the worst of the steps inside it (issue #102).
 */
export function stepRatingOf(badges: Record<string, StepBadge>): (stepId: string) => { rank: number; label: string } | null {
  return (stepId) => {
    const b = badges[stepId];
    return b ? { rank: ratingRank(b.rating), label: RATING_LABELS[b.rating] } : null;
  };
}

/**
 * The red badges on the map (issue #99): open issues somebody has confirmed, that is, tracked in the register.
 * What a run only detected (an insight nobody has acknowledged yet) colours the step through its rating but
 * never adds to a badge.
 */
export function confirmedBadges(entries: readonly RegisterEntry[]): Record<string, StepBadge> {
  return stepBadges(entries.filter((e) => e.kind === "tracked"));
}

/**
 * What colours a step on the map (issue #99, decision D24): the worst rating among its confirmed open issues. Nothing
 * a run only detected reaches the map until someone acknowledges it, and a step with no confirmed issue stays
 * uncoloured. A stored issue with the lowest severity reads as Great, which is not a problem to colour a step by.
 */
export function confirmedRatings(entries: readonly RegisterEntry[]): Record<string, StepBadge> {
  return stepBadges(entries.filter((e) => e.kind === "tracked" && entryView(e).rating !== "great"));
}

/** Open findings per step: each step's count and worst rating, whether tracked or only detected. */
export function stepBadges(entries: readonly RegisterEntry[]): Record<string, StepBadge> {
  const out: Record<string, StepBadge> = {};
  for (const e of entries) {
    const v = entryView(e);
    if (!v.open || !v.stepId) continue;
    const b = (out[v.stepId] ??= { count: 0, rating: v.rating, titles: [] });
    b.count++;
    b.titles.push(v.title);
    if (compareRatingsDesc(v.rating, b.rating) < 0) b.rating = v.rating;
  }
  return out;
}
