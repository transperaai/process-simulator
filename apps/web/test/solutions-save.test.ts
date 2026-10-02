import { beforeEach, describe, expect, it, vi } from "vitest";
import { northbeamIssues, northbeamStepIds as ids, type IssueRow, type SolutionRow } from "@transpera-flow/db";
import { solutionCopy } from "@/lib/solutions/bundle";
import { issueAboutProcess } from "@/lib/solutions/area";
import { linkProblem, verdictForCopy } from "@/lib/solutions/server-verdict";
import { demoBundle } from "@/lib/sources/demo";

// The Server Actions that save a solution (issue #114): they write only the solution's own rows, as the signed-in user, and
// never the process's live version or its draft (D18). The automatic verdict is worked out on the server; what the browser sends is ignored.

const db = vi.hoisted(() => ({
  signedIn: true,
  calls: [] as { op: string; args: unknown[] }[],
  rpcResult: { data: null as unknown, error: null as { code?: string; message?: string } | null },
  insertResult: { data: null as unknown, error: null as { code?: string; message?: string } | null },
  solution: null as unknown,
  verdict: { ok: true, verdict: { status: "fail", holdsPct: 12, note: "Hands-on time: 9 h on average, against under 3 hours.", value: 9 } } as unknown,
  verdictCalls: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/solutions/server-verdict", async (orig) => ({
  ...(await orig<typeof import("@/lib/solutions/server-verdict")>()),
  serverVerdict: async (args: unknown) => (db.verdictCalls.push(args), db.verdict),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    let inserting = false;
    const chain = {
      insert: (...args: unknown[]) => ((inserting = true), db.calls.push({ op: "insert", args }), chain),
      select: () => chain,
      eq: () => chain,
      single: async () => db.insertResult,
      maybeSingle: async () => ({ data: db.solution, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(inserting ? db.insertResult : { data: [], error: null }),
    };
    return {
      auth: { getClaims: async () => ({ data: db.signedIn ? { claims: { sub: "u1" } } : null }) },
      from: (table: string) => (db.calls.push({ op: "from", args: [table] }), chain),
      rpc: async (fn: string, args: unknown) => (db.calls.push({ op: "rpc", args: [fn, args] }), db.rpcResult),
    };
  },
}));
const { createSolution, linkSolutionToIssue } = await import("@/app/w/[slug]/solution-actions");

const WS = "a0000000-0000-4000-8000-000000000001";
const ISSUE = "3f1c2b4a-0000-4000-8000-000000000001";
const live = demoBundle();
const solutionRow = { id: "5f1c2b4a-0000-4000-8000-000000000009", name: "AI lead qualifier" } as unknown as SolutionRow;
const input = () => ({
  name: "AI lead qualifier",
  processId: live.process.id,
  baseRevisionId: live.revision.id,
  copy: solutionCopy({ steps: live.steps.map((s) => (s.id === ids.audit ? { ...s, work_hours: 3 } : s)), edges: live.edges }),
  changedStepIds: [ids.audit],
  levers: [],
  // What a browser might claim: ignored.
  links: [{ issueId: ISSUE, autoVerdict: "pass", holdsPct: 95, autoNote: "ok" }],
});
const tables = () => db.calls.filter((c) => c.op === "from").map((c) => c.args[0]);
const rpcArgs = () => db.calls.find((c) => c.op === "rpc")!.args[1] as { p_links: unknown[]; p_steps: { steps: { id: string; work_hours: number }[] } };

beforeEach(() => {
  db.signedIn = true;
  db.calls = [];
  db.verdictCalls = [];
  db.rpcResult = { data: solutionRow, error: null };
  db.insertResult = { data: null, error: null };
  db.solution = { id: solutionRow.id, process_id: live.process.id, base_revision_id: live.revision.id, steps: input().copy };
  db.verdict = { ok: true, verdict: { status: "fail", holdsPct: 12, note: "Hands-on time: 9 h on average, against under 3 hours.", value: 9 } };
});

describe("createSolution", () => {
  it("saves through save_solution with the server's verdict, not the browser's", async () => {
    const r = await createSolution(WS, input());
    expect(r.status).toBe("ok");
    expect(rpcArgs().p_links).toEqual([{ issue_id: ISSUE, auto_verdict: "fail", holds_pct: 12, auto_note: "Hands-on time: 9 h on average, against under 3 hours." }]);
    expect(db.verdictCalls).toHaveLength(1);
    expect(db.verdictCalls[0]).toMatchObject({ workspaceId: WS, processId: live.process.id, baseRevisionId: live.revision.id, issueId: ISSUE });
    // Nothing of the process: not its revisions, steps, edges or draft; only the link table is read back.
    expect(tables()).toEqual(["solution_issues"]);
    expect(db.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("stores no verdict, with the reason, when the target can't be checked", async () => {
    db.verdict = { ok: true, verdict: { status: "unchecked", holdsPct: null, note: "Couldn't read the goal.", value: null } };
    await createSolution(WS, input());
    expect(rpcArgs().p_links).toEqual([{ issue_id: ISSUE, auto_verdict: null, holds_pct: null, auto_note: "Couldn't read the goal." }]);
  });

  it("refuses, without saving, an issue that is closed, a detection or about another process", async () => {
    db.verdict = { ok: false, message: "That issue is already resolved or marked won't fix, so a solution can't be linked to it. Reopen it first." };
    expect(await createSolution(WS, input())).toEqual({ status: "error", message: "That issue is already resolved or marked won't fix, so a solution can't be linked to it. Reopen it first." });
    expect(db.calls.filter((c) => c.op === "rpc")).toEqual([]);
  });

  it("stores the copy as sent, apart from the live steps", async () => {
    await createSolution(WS, input());
    expect(rpcArgs().p_steps.steps.find((s) => s.id === ids.audit)!.work_hours).toBe(3);
    expect(live.steps.find((s) => s.id === ids.audit)!.work_hours).toBe(9);
  });

  it("saves a solution with no issue, without simulating", async () => {
    expect((await createSolution(WS, { ...input(), links: [] })).status).toBe("ok");
    expect(rpcArgs().p_links).toEqual([]);
    expect(db.verdictCalls).toEqual([]);
  });

  it("refuses without calling the database when signed out, or when the input is bad", async () => {
    db.signedIn = false;
    expect(await createSolution(WS, input())).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    db.signedIn = true;
    expect(await createSolution(WS, { ...input(), name: " " })).toEqual({ status: "error", message: "Name the solution first." });
    expect(await createSolution("nope", input())).toEqual({ status: "error", message: "That solution isn't valid." });
    expect(db.calls.filter((c) => c.op === "rpc")).toEqual([]);
  });

  it("says in plain English what the database refused, and calls it a permission problem only when it is one", async () => {
    const fail = async (error: { code?: string; message?: string }) => {
      db.rpcResult = { data: null, error };
      return (await createSolution(WS, input())) as { message: string };
    };
    expect((await fail({ code: "42501", message: "new row violates row-level security policy" })).message).toBe("You don't have permission to save solutions here.");
    expect((await fail({ code: "23514", message: "solutions: that issue is closed, so it cannot be linked" })).message).toMatch(/resolved, marked won't fix or dismissed/);
    expect((await fail({ code: "23514", message: "solutions: that issue is only a detection, so it cannot be linked" })).message).toMatch(/only a detection/);
    expect((await fail({ code: "23514", message: "solutions: that issue is about another process" })).message).toMatch(/another process/);
    expect((await fail({ code: "23514", message: "solutions: the base revision must be a published version of the process" })).message).toMatch(/published version/);
    expect((await fail({ code: "23503" })).message).toMatch(/no longer there/);
    expect((await fail({ code: "XX000" })).message).toBe("Couldn't save the solution. Try again.");
  });
});

describe("linkSolutionToIssue", () => {
  const SOL = solutionRow.id;
  it("links a saved solution to an issue with the server's verdict, whatever the browser claims", async () => {
    db.insertResult = { data: { solution_id: SOL, issue_id: ISSUE }, error: null };
    const r = await linkSolutionToIssue(WS, SOL, ISSUE);
    expect(r.status).toBe("ok");
    expect(tables()).toEqual(["solutions", "solution_issues"]);
    expect(db.calls.find((c) => c.op === "insert")!.args[0]).toMatchObject({ solution_id: SOL, issue_id: ISSUE, workspace_id: WS, auto_verdict: "fail", holds_pct: 12 });
    expect(db.verdictCalls[0]).toMatchObject({ processId: live.process.id, issueId: ISSUE });
  });

  it("refuses a closed issue, another process's issue or a missing solution, and a second link to the same issue", async () => {
    db.verdict = { ok: false, message: "That issue is about another process, so this solution can't be linked to it." };
    expect(await linkSolutionToIssue(WS, SOL, ISSUE)).toEqual({ status: "error", message: "That issue is about another process, so this solution can't be linked to it." });
    expect(db.calls.some((c) => c.op === "insert")).toBe(false);
    db.solution = null;
    expect(await linkSolutionToIssue(WS, SOL, ISSUE)).toEqual({ status: "error", message: "That solution isn't there any more." });
    db.solution = { id: SOL, process_id: live.process.id, base_revision_id: live.revision.id, steps: input().copy };
    db.verdict = { ok: true, verdict: { status: "pass", holdsPct: 90, note: "", value: 1 } };
    db.insertResult = { data: null, error: { code: "23505" } };
    expect(await linkSolutionToIssue(WS, SOL, ISSUE)).toEqual({ status: "error", message: "That solution is already linked to this issue." });
  });

  it("refuses when signed out or given something that isn't an id", async () => {
    expect(await linkSolutionToIssue("x", SOL, ISSUE)).toMatchObject({ status: "error" });
    db.signedIn = false;
    expect(await linkSolutionToIssue(WS, SOL, ISSUE)).toMatchObject({ status: "error", message: "Your session has ended. Sign in again." });
  });
});

describe("what can be linked, and the verdict worked out from the stored copy", () => {
  const issue = (over: Partial<IssueRow>) => ({ ...northbeamIssues()[0]!, links: [], target_measure: "Hands-on time per proposal", target_now: "9 h", target_goal: "under 3 hours", ...over }) as IssueRow;
  const P = live.process.id;

  it("allows an open or testing issue about the process, and says why not otherwise", () => {
    expect(linkProblem(issue({ process_id: P, status: "open" }), P)).toBeNull();
    expect(linkProblem(issue({ process_id: null, status: "testing", links: [{ process_id: P, step_id: ids.audit }] }), P)).toBeNull();
    expect(linkProblem(null, P)).toMatch(/isn't there/);
    expect(linkProblem(issue({ process_id: P, status: "dismissed" }), P)).toMatch(/dismissed/);
    expect(linkProblem(issue({ process_id: P, status: "resolved" }), P)).toMatch(/resolved or marked won't fix/);
    expect(linkProblem(issue({ process_id: P, status: "wont_fix" }), P)).toMatch(/won't fix/);
    expect(linkProblem(issue({ process_id: P, source: "detected" }), P)).toMatch(/only a detection/);
    expect(linkProblem(issue({ process_id: "other", links: [{ process_id: "other", step_id: null }] }), P)).toMatch(/another process/);
    expect(issueAboutProcess(issue({ process_id: "other", links: [{ process_id: P, step_id: null }] }), P)).toBe(true);
  });

  it("simulates the stored copy on the base and checks the issue's target, from the database's own issue", () => {
    const a = issue({ process_id: P, links: [{ process_id: P, step_id: ids.audit }] });
    const slow = verdictForCopy({ base: live, copy: solutionCopy(live), issue: a, processId: P });
    const fast = verdictForCopy({ base: live, copy: input().copy, issue: a, processId: P });
    expect(slow).toMatchObject({ ok: true, verdict: { status: "fail", holdsPct: 0 } });
    expect(fast).toMatchObject({ ok: true, verdict: { status: "pass", holdsPct: 100 } });
    // Deterministic.
    expect(verdictForCopy({ base: live, copy: input().copy, issue: a, processId: P })).toEqual(fast);
  });
});
