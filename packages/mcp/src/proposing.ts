// What the MCP proposal tools store (docs/PRD.md §7.1c; issue #117, A52): a proposed issue or a solution idea, free
// of I/O. Given the names a tool already resolved to ids, build the `suggestion_proposals` row to insert. Nothing
// here writes an issue or a solution: a person accepts a proposed issue in the app (through the Acknowledge path)
// and builds a solution idea in the Editor.

import type { EvidenceCitation, IssueLinkRef, IssueProposalPayload, ProposedStep, SolutionIdeaPayload } from "@transpera-flow/db";
import type { IssueType } from "@transpera-flow/engine";
import { ToolError } from "./result";

/** One row to insert into `suggestion_proposals`. */
export interface ProposalInsert {
  kind: "issue" | "solution_idea";
  title: string;
  detail: string | null;
  payload: IssueProposalPayload | SolutionIdeaPayload;
  evidence: EvidenceCitation[];
  note: string | null;
  issue_id: string | null;
}

export const MAX_PROPOSED_STEPS = 30;
const MAX_TITLE = 200;
const MAX_DETAIL = 5000;

const clean = (v: string | undefined | null) => v?.trim() || null;

function title(raw: string): string {
  const t = raw.trim();
  if (!t) throw new ToolError("invalid_input", "Give a title");
  if (t.length > MAX_TITLE) throw new ToolError("invalid_input", `The title can be at most ${MAX_TITLE} characters`);
  return t;
}

function detail(raw: string | undefined): string | null {
  const d = clean(raw);
  if (d && d.length > MAX_DETAIL) throw new ToolError("invalid_input", `The detail can be at most ${MAX_DETAIL} characters`);
  return d;
}

export interface IssueProposalArgs {
  title: string;
  detail?: string;
  /** Stored severity (the tool maps its rating to it). */
  severity: "critical" | "serious" | "warning" | "info";
  type?: IssueType;
  /** What it touches, already resolved: a whole process (`step_id` null) or steps. Not both. */
  links: IssueLinkRef[];
  target_measure?: string;
  target_now?: string;
  target_goal?: string;
  evidence?: EvidenceCitation[];
  note?: string;
}

/** A proposed issue: logged only when a person accepts it. */
export function buildIssueProposal(args: IssueProposalArgs): ProposalInsert {
  if (args.links.some((l) => !l.step_id) && args.links.some((l) => l.step_id)) {
    throw new ToolError("invalid_input", "Link the whole process or pick steps, not both");
  }
  const payload: IssueProposalPayload = { severity: args.severity, type: args.type ?? "manual" };
  if (args.links.length) payload.links = args.links;
  for (const k of ["target_measure", "target_now", "target_goal"] as const) {
    const v = clean(args[k]);
    if (v) {
      if (v.length > 200) throw new ToolError("invalid_input", `${k} can be at most 200 characters`);
      payload[k] = v;
    }
  }
  return {
    kind: "issue",
    title: title(args.title),
    detail: detail(args.detail),
    payload,
    evidence: args.evidence ?? [],
    note: clean(args.note),
    issue_id: null,
  };
}

export interface SolutionIdeaStepArg {
  name: string;
  kind?: string;
  role?: string;
  /** A library block the step comes from (already resolved to its id), or null. */
  block_id?: string | null;
  /** True for an AI block (no library block behind it). */
  ai?: boolean;
}

export interface SolutionIdeaArgs {
  /** The issue the idea is for, already resolved. */
  issue_id: string;
  title: string;
  detail?: string;
  steps: SolutionIdeaStepArg[];
  /** Step ids the proposed steps would replace, already resolved. */
  replaces_step_ids?: string[];
  expect?: string;
  evidence?: EvidenceCitation[];
  note?: string;
}

/**
 * A solution idea: the proposed steps in order (each leads to the next), what they would replace and what the AI
 * expects. Not built and not simulated; its block map and "Build it" come in slice 2.
 */
export function buildSolutionIdeaProposal(args: SolutionIdeaArgs): ProposalInsert {
  if (!args.steps.length) throw new ToolError("invalid_input", "Give at least one step");
  if (args.steps.length > MAX_PROPOSED_STEPS) throw new ToolError("invalid_input", `An idea can have at most ${MAX_PROPOSED_STEPS} steps`);
  const steps: ProposedStep[] = args.steps.map((s, i) => {
    const name = s.name.trim();
    if (!name) throw new ToolError("invalid_input", `Step ${i + 1} needs a name`);
    const step: ProposedStep = { key: `s${i + 1}`, name };
    if (clean(s.kind)) step.kind = clean(s.kind)!;
    if (clean(s.role)) step.role = clean(s.role)!;
    if (s.block_id) step.block_id = s.block_id;
    if (s.ai) step.ai = true;
    return step;
  });
  const payload: SolutionIdeaPayload = {
    steps,
    edges: steps.slice(1).map((s, i) => ({ from: steps[i]!.key, to: s.key })),
  };
  if (args.replaces_step_ids?.length) payload.replaces_step_ids = [...new Set(args.replaces_step_ids)];
  const expect = clean(args.expect);
  if (expect) payload.expect = expect;
  return {
    kind: "solution_idea",
    title: title(args.title),
    detail: detail(args.detail),
    payload,
    evidence: args.evidence ?? [],
    note: clean(args.note),
    issue_id: args.issue_id,
  };
}

/** What `matchIssue` looks at. */
export interface IssueRef {
  id: string;
  number: number | null;
  title: string;
  status: string;
}

/**
 * The issue a tool call names: `#12` or `12` (its number), its id, or its title (exact, else the only partial match).
 * Only issues a person tracks (with a number) that are still open or being tested can be given ideas.
 */
export function matchIssue(issues: readonly IssueRef[], ref: string): IssueRef {
  const needle = ref.trim().toLowerCase().replace(/^#/, "");
  const list = (xs: readonly IssueRef[]) => xs.map((i) => ({ id: i.id, number: i.number, title: i.title }));
  const tracked = issues.filter((i) => i.number !== null);
  let match = tracked.filter((i) => String(i.number) === needle || i.id.toLowerCase() === needle);
  if (!match.length) match = tracked.filter((i) => i.title.toLowerCase() === needle);
  if (!match.length) match = tracked.filter((i) => i.title.toLowerCase().includes(needle));
  if (match.length > 1) throw new ToolError("ambiguous", `'${ref}' matches more than one issue`, list(match));
  if (!match.length) throw new ToolError("not_found", `No issue matches '${ref}'`, list(tracked).slice(0, 50));
  const issue = match[0]!;
  if (issue.status !== "open" && issue.status !== "testing") {
    throw new ToolError("invalid_input", `Issue #${issue.number} is already closed, so it can't be given ideas. Reopen it first.`);
  }
  return issue;
}
