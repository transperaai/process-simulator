// The automatic verdict, worked out again on the server (issue #114, A49 review). The browser shows a verdict while you edit, but
// what is stored is never what the browser sent: saving and linking simulate the stored copy here, with the engine, against the
// issue's target as it is in the database. The client's numbers are ignored. Same seeds as the Editor's compare (30 runs, seed 1).

import { isActiveStatus, listProcesses, loadIssue, loadProcessBundle, ModelError, toEngineModel, type BlockBundle, type Db, type IssueRow, type ProcessBundle } from "@transpera-flow/db";
import { simulate } from "@transpera-flow/engine";
import { currentArea, issueAboutProcess, leafIds, solutionIssueOf } from "./area";
import { bundleFromSolution } from "./bundle";
import { checkTarget, type TargetVerdict } from "./verdict";

/** Why an issue can't be linked to a solution of `processId`, in plain English, or null. */
export function linkProblem(issue: IssueRow | null, processId: string): string | null {
  if (!issue || issue.status === "dismissed") return "That issue isn't there, or has been dismissed, so a solution can't be linked to it.";
  if (issue.source === "detected") return "That issue is only a detection. Acknowledge it as an issue first.";
  if (!isActiveStatus(issue.status)) return "That issue is already resolved or marked won't fix, so a solution can't be linked to it. Reopen it first.";
  if (!issueAboutProcess(issue, processId)) return "That issue is about another process, so this solution can't be linked to it.";
  return null;
}

/** The process as it was at `revisionId`, for simulating a solution against it. */
async function baseBundle(db: Db, workspaceId: string, processId: string, revisionId: string): Promise<ProcessBundle | null> {
  const { data: workspace } = await db.from("workspaces").select("id, name, slug, settings").eq("id", workspaceId).maybeSingle();
  if (!workspace) return null;
  const process = (await listProcesses(db, workspaceId)).find((p) => p.id === processId);
  if (!process) return null;
  const { draft_revision_id: _draft, ...row } = process;
  void _draft;
  return loadProcessBundle(db, workspace, row, revisionId);
}

export type ServerVerdict = { ok: true; verdict: TargetVerdict } | { ok: false; message: string };

/** The pure part: simulate the copy on top of `base` and check it against the issue's target. */
export function verdictForCopy(args: { base: ProcessBundle; copy: BlockBundle; issue: IssueRow; processId: string }): ServerVerdict {
  const { base, issue } = args;
  const solved = bundleFromSolution(base, { steps: args.copy });
  let model;
  try {
    model = toEngineModel(solved);
  } catch (err) {
    if (err instanceof ModelError) return { ok: false, message: `The solution can't be simulated: ${err.message}.` };
    throw err;
  }
  const result = simulate(model, 30, 1);
  const was = new Set(base.steps.map((s) => s.id));
  const added = solved.steps.filter((s) => !was.has(s.id)).map((s) => s.id);
  const asIssue = solutionIssueOf(issue, args.processId, solved.steps);
  const area = leafIds(solved.steps, asIssue.whole ? solved.steps.filter((s) => s.parent_step_id === null).map((s) => s.id) : currentArea(asIssue, solved.steps, added));
  return { ok: true, verdict: checkTarget({ target: asIssue.target, model, result, area }) };
}

/**
 * Checks a stored copy of a process against an issue's target. Returns why the link isn't allowed (closed, a detection, another
 * process), or the verdict: `unchecked` when the target can't be turned into a number the simulation computes.
 */
export async function serverVerdict(args: {
  db: Db;
  workspaceId: string;
  processId: string;
  baseRevisionId: string;
  copy: BlockBundle;
  issueId: string;
  /** The base bundle, if the caller has already loaded it for another link. */
  base?: ProcessBundle;
}): Promise<ServerVerdict & { base?: ProcessBundle }> {
  const issue = await loadIssue(args.db, args.workspaceId, args.issueId);
  const problem = linkProblem(issue, args.processId);
  if (problem) return { ok: false, message: problem };
  const base = args.base ?? (await baseBundle(args.db, args.workspaceId, args.processId, args.baseRevisionId));
  if (!base) return { ok: false, message: "The process or its live version is no longer there. Reload and try again." };
  const r = verdictForCopy({ base, copy: args.copy, issue: issue!, processId: args.processId });
  return r.ok ? { ...r, base } : r;
}
