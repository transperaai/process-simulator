"use server";

import { SOLUTION_ISSUE_COLUMNS, type Json, type SolutionIssueRow, type SolutionRow, type SolutionVerdict } from "@transpera-flow/db";
import { parseSolutionInput, type SaveSolutionResult } from "@/lib/solutions/save";
import { isId } from "@/lib/sources/validate";
import { createClient } from "@/lib/supabase/server";

// Saving a solution (issue #114, A49). `save_solution` creates the solution and its links in one transaction, as the
// signed-in user through row-level security (owners and editors write; everyone in the workspace reads). It writes only
// the solution's own rows: the process, its live version and its draft are never touched (D18). Linking an issue moves it to
// Testing solutions and logs the event in the database (`solution_issue_tested`, through A47's history).

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;
const forbidden = { status: "error", message: "You don't have permission to save solutions here." } as const;
const invalid = { status: "error", message: "That solution isn't valid." } as const;

function failure(error: { code?: string; message?: string }) {
  if (error.code === "42501") return forbidden;
  if (error.code === "23503") return { status: "error", message: "The process, its live version or an issue is no longer there. Reload and try again." } as const;
  if (error.code === "23514") return { status: "error", message: "Some of those values aren't allowed." } as const;
  return { status: "error", message: "Couldn't save the solution. Try again." } as const;
}

/** Save a solution, with the issues it solves and the automatic verdict against each. */
export async function createSolution(workspaceId: unknown, input: unknown): Promise<SaveSolutionResult> {
  if (!isId(workspaceId)) return invalid;
  const parsed = parseSolutionInput(input);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return signedOut;
  const v = parsed.value;
  const { data, error } = await supabase.rpc("save_solution", {
    p_workspace: workspaceId,
    p_process: v.processId,
    p_base_revision: v.baseRevisionId,
    p_name: v.name,
    p_steps: v.copy as unknown as Json,
    p_changed: v.changedStepIds as unknown as Json,
    p_levers: v.levers as unknown as Json,
    p_links: v.links.map((l) => ({ issue_id: l.issueId, auto_verdict: l.autoVerdict, holds_pct: l.holdsPct, auto_note: l.autoNote })) as unknown as Json,
  });
  if (error) return failure(error);
  const solution = data as unknown as SolutionRow;
  const { data: links } = await supabase.from("solution_issues").select(SOLUTION_ISSUE_COLUMNS).eq("solution_id", solution.id);
  return { status: "ok", solution, links: (links ?? []) as unknown as SolutionIssueRow[] };
}

export type LinkSolutionResult = { status: "ok"; link: SolutionIssueRow } | { status: "error"; message: string };

/**
 * Link a saved solution to an issue it solves, with the automatic verdict the simulation gave. The issue moves to Testing
 * solutions. (For a solution started without an issue; A50's solution page puts a button on it.)
 */
export async function linkSolutionToIssue(
  workspaceId: unknown,
  solutionId: unknown,
  issueId: unknown,
  auto: { verdict: SolutionVerdict | null; holdsPct: number | null; note: string },
): Promise<LinkSolutionResult> {
  if (!isId(workspaceId) || !isId(solutionId) || !isId(issueId)) return invalid;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return signedOut;
  const verdict = auto.verdict === "pass" || auto.verdict === "fail" ? auto.verdict : null;
  const holds = verdict && typeof auto.holdsPct === "number" && Number.isFinite(auto.holdsPct) ? Math.min(100, Math.max(0, Math.round(auto.holdsPct))) : null;
  const { data, error } = await supabase
    .from("solution_issues")
    .insert({ solution_id: solutionId, issue_id: issueId, workspace_id: workspaceId, auto_verdict: verdict, holds_pct: holds, auto_note: String(auto.note ?? "").slice(0, 1000) })
    .select(SOLUTION_ISSUE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return { status: "error", message: "That solution is already linked to this issue." };
    return failure(error);
  }
  return { status: "ok", link: data as unknown as SolutionIssueRow };
}
