// The Processes page's rows (issue #101): every process in the company map's order (each followed by the processes
// inside it), with the numbers beside it. Pure: the page loads the facts, this works out the rows.

import { companyMap, flattenCompanyMap, type IssueLinkRef, type IssueRow, type StepRow } from "@transpera-flow/db";
import { compareRatingsDesc, ratingOfStored, type Rating } from "@transpera-flow/engine";

export interface ProcessFacts {
  id: string;
  name: string;
  kind: "pipeline" | "servicing";
  /** What the process is for, shown as its goal line. */
  description: string | null;
  parentId: string | null;
  /** Published at least once. */
  live: boolean;
  /** Has an open draft. */
  draft: boolean;
}

export interface LiveVersion {
  number: number;
  /** When it was published (an ISO date), or null when unknown. */
  publishedAt: string | null;
}

export interface ProcessRowData extends ProcessFacts {
  /** 1 for a top-level process, 2 for one inside it, and so on. */
  depth: number;
  /** The processes it sits inside, outermost first (for breadcrumbs). */
  trail: { id: string; name: string }[];
  /** Working steps in it, and in the processes inside it. */
  steps: number;
  /** Open tracked issues on it and the processes inside it. */
  openIssues: number;
  /** The worst rating among those issues (a Great one is not a problem), or null when there is none. */
  rating: Rating | null;
  version: LiveVersion | null;
}

type StepFact = Pick<StepRow, "process_id" | "kind" | "child_process_id"> & { id?: string };
/** An issue as these tallies need it: where it sits (the compatibility columns, and every link when it has them), and how bad and open it is. */
type IssueFact = Pick<IssueRow, "process_id" | "step_id" | "severity" | "status"> & { links?: readonly IssueLinkRef[] };
type Tally = { steps: number; issues: number; rating: Rating | null };

/**
 * An issue belongs to a process when it names it, or (a manual issue with no process) names one of its steps, or
 * any of the things it links to is the process or one of its steps (an issue can touch steps in several processes).
 */
export function isOnProcess(i: Pick<IssueRow, "process_id" | "step_id"> & { links?: readonly IssueLinkRef[] }, processId: string, stepIds: ReadonlySet<string>): boolean {
  if (i.process_id === processId || (!i.process_id && !!i.step_id && stepIds.has(i.step_id))) return true;
  return (i.links ?? []).some((l) => l.process_id === processId || (!!l.step_id && stepIds.has(l.step_id)));
}

const isWorking = (s: StepFact) => (s.kind === "task" || s.kind === "wait" || s.kind === "decision" || s.kind === "subprocess") && !s.child_process_id;

const worse = (a: Rating | null, b: Rating | null): Rating | null => (a === null ? b : b === null ? a : compareRatingsDesc(b, a) < 0 ? b : a);

export function processRows(input: {
  processes: readonly ProcessFacts[];
  /** The steps of each process's live revision. */
  steps: readonly StepFact[];
  issues: readonly IssueFact[];
  versions: ReadonlyMap<string, LiveVersion>;
}): ProcessRowData[] {
  const nodes = companyMap(input.processes);
  const flat = flattenCompanyMap(nodes);

  const own = new Map<string, Tally>();
  const mine = (id: string): Tally => {
    let o = own.get(id);
    if (!o) own.set(id, (o = { steps: 0, issues: 0, rating: null }));
    return o;
  };
  const stepProcess = new Map<string, string>();
  for (const s of input.steps) {
    if (s.id) stepProcess.set(s.id, s.process_id);
    if (isWorking(s)) mine(s.process_id).steps++;
  }
  for (const i of input.issues) {
    if (i.status !== "open" && i.status !== "testing") continue;
    // Every process it touches counts it once: the one the compatibility columns name, and each its links reach.
    const where = new Set<string>();
    const add = (processId: string | null | undefined, stepId: string | null | undefined) => {
      const pid = processId ?? (stepId ? stepProcess.get(stepId) : undefined);
      if (pid) where.add(pid);
    };
    add(i.process_id, i.step_id);
    for (const l of i.links ?? []) add(l.process_id, l.step_id);
    const r = ratingOfStored(i.severity);
    for (const pid of where) {
      const o = mine(pid);
      o.issues++;
      if (r !== "great") o.rating = worse(o.rating, r);
    }
  }

  // Each process's numbers include those of the processes inside it.
  const total = new Map<string, Tally>();
  const sum = (n: (typeof nodes)[number]): Tally => {
    const t = { ...(own.get(n.process.id) ?? { steps: 0, issues: 0, rating: null }) };
    for (const c of n.children) {
      const x = sum(c);
      t.steps += x.steps;
      t.issues += x.issues;
      t.rating = worse(t.rating, x.rating);
    }
    total.set(n.process.id, t);
    return t;
  };
  nodes.forEach(sum);

  const byId = new Map(flat.map((f) => [f.process.id, f.process]));
  return flat.map(({ process: p, depth }) => {
    const t = total.get(p.id) ?? { steps: 0, issues: 0, rating: null };
    return {
      ...p,
      depth,
      trail: trailOf(p, byId),
      steps: t.steps,
      openIssues: t.issues,
      rating: t.rating,
      version: input.versions.get(p.id) ?? null,
    };
  });
}

/** The processes a process sits inside, outermost first. Stops (rather than loops) on bad data. */
export function trailOf(p: { id: string; parentId: string | null }, byId: ReadonlyMap<string, { id: string; name: string; parentId: string | null }>): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const seen = new Set([p.id]);
  for (let q = p.parentId ? byId.get(p.parentId) : undefined; q && !seen.has(q.id); q = q.parentId ? byId.get(q.parentId) : undefined) {
    out.unshift({ id: q.id, name: q.name });
    seen.add(q.id);
  }
  return out;
}

/** Each process's rating (the worst of its open issues, and of the processes inside it), by id: the process switcher's dots. */
export function processRatings(
  processes: readonly { id: string; name: string; kind: "pipeline" | "servicing"; parentId?: string | null }[],
  issues: readonly IssueFact[],
  /** The live steps of every process, so an issue that names only a step still counts toward its process. */
  steps: readonly StepFact[] = [],
): Record<string, Rating | null> {
  const rows = processRows({
    processes: processes.map((p) => ({ ...p, description: null, parentId: p.parentId ?? null, live: true, draft: false })),
    steps,
    issues,
    versions: new Map(),
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.rating]));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct", or "1 Oct 2025" when it was not this year; empty when there is no date. */
export function shortDate(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${d.getUTCFullYear()}`;
}
