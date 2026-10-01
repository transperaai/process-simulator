import { beforeEach, describe, expect, it, vi } from "vitest";
import { northbeamStepIds as ids, type SolutionRow } from "@transpera-flow/db";
import { solutionCopy } from "@/lib/solutions/bundle";
import { demoBundle } from "@/lib/sources/demo";

// The Server Actions that save a solution (issue #114): they write only the solution's own rows, as the signed-in user, and
// never the process's live version or its draft (D18).

const db = vi.hoisted(() => ({
  signedIn: true,
  calls: [] as { op: string; args: unknown[] }[],
  rpcResult: { data: null as unknown, error: null as { code?: string } | null },
  insertResult: { data: null as unknown, error: null as { code?: string } | null },
  linkRows: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    let inserting = false;
    const chain = {
      insert: (...args: unknown[]) => ((inserting = true), db.calls.push({ op: "insert", args }), chain),
      select: () => chain,
      eq: () => chain,
      single: async () => db.insertResult,
      then: (resolve: (v: unknown) => void) => resolve(inserting ? db.insertResult : { data: db.linkRows, error: null }),
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
  links: [{ issueId: ISSUE, autoVerdict: "pass", holdsPct: 95, autoNote: "ok" }],
});
const tables = () => db.calls.filter((c) => c.op === "from").map((c) => c.args[0]);

beforeEach(() => {
  db.signedIn = true;
  db.calls = [];
  db.rpcResult = { data: solutionRow, error: null };
  db.insertResult = { data: null, error: null };
  db.linkRows = [];
});

describe("createSolution", () => {
  it("saves through save_solution and reads back only the solution's own links", async () => {
    const r = await createSolution(WS, input());
    expect(r.status).toBe("ok");
    const rpc = db.calls.find((c) => c.op === "rpc")!;
    expect(rpc.args[0]).toBe("save_solution");
    expect(rpc.args[1]).toMatchObject({
      p_workspace: WS,
      p_process: live.process.id,
      p_base_revision: live.revision.id,
      p_name: "AI lead qualifier",
      p_changed: [ids.audit],
      p_levers: [],
      p_links: [{ issue_id: ISSUE, auto_verdict: "pass", holds_pct: 95, auto_note: "ok" }],
    });
    // Nothing of the process: not its revisions, steps, edges or draft; only the link table is read back.
    expect(tables()).toEqual(["solution_issues"]);
    expect(db.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("stores the copy as sent, apart from the live steps", async () => {
    await createSolution(WS, input());
    const sent = (db.calls.find((c) => c.op === "rpc")!.args[1] as { p_steps: { steps: { id: string; work_hours: number }[] } }).p_steps;
    expect(sent.steps.find((s) => s.id === ids.audit)!.work_hours).toBe(3);
    expect(live.steps.find((s) => s.id === ids.audit)!.work_hours).toBe(9);
  });

  it("saves a solution with no issue", async () => {
    expect((await createSolution(WS, { ...input(), links: [] })).status).toBe("ok");
    expect((db.calls.find((c) => c.op === "rpc")!.args[1] as { p_links: unknown[] }).p_links).toEqual([]);
  });

  it("refuses without calling the database when signed out, or when the input is bad", async () => {
    db.signedIn = false;
    expect(await createSolution(WS, input())).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    db.signedIn = true;
    expect(await createSolution(WS, { ...input(), name: " " })).toEqual({ status: "error", message: "Name the solution first." });
    expect(await createSolution("nope", input())).toEqual({ status: "error", message: "That solution isn't valid." });
    expect(db.calls.filter((c) => c.op === "rpc")).toEqual([]);
  });

  it("says in plain English when the database refuses", async () => {
    db.rpcResult = { data: null, error: { code: "42501" } };
    expect(await createSolution(WS, input())).toEqual({ status: "error", message: "You don't have permission to save solutions here." });
    db.rpcResult = { data: null, error: { code: "23503" } };
    expect(await createSolution(WS, input())).toMatchObject({ status: "error", message: expect.stringMatching(/no longer there/) });
    db.rpcResult = { data: null, error: { code: "XX000" } };
    expect(await createSolution(WS, input())).toEqual({ status: "error", message: "Couldn't save the solution. Try again." });
  });
});

describe("linkSolutionToIssue", () => {
  const SOL = "5f1c2b4a-0000-4000-8000-000000000009";
  it("links a saved solution to an issue, with the verdict, and touches only the link table", async () => {
    db.insertResult = { data: { solution_id: SOL, issue_id: ISSUE, auto_verdict: "fail", holds_pct: 10 }, error: null };
    const r = await linkSolutionToIssue(WS, SOL, ISSUE, { verdict: "fail", holdsPct: 10.4, note: "x" });
    expect(r.status).toBe("ok");
    expect(tables()).toEqual(["solution_issues"]);
    expect(db.calls.find((c) => c.op === "insert")!.args[0]).toMatchObject({ solution_id: SOL, issue_id: ISSUE, workspace_id: WS, auto_verdict: "fail", holds_pct: 10, auto_note: "x" });
  });

  it("drops the percentage when there is no verdict, and refuses a second link to the same issue", async () => {
    await linkSolutionToIssue(WS, SOL, ISSUE, { verdict: null, holdsPct: 50, note: "" });
    expect(db.calls.find((c) => c.op === "insert")!.args[0]).toMatchObject({ auto_verdict: null, holds_pct: null });
    db.insertResult = { data: null, error: { code: "23505" } };
    expect(await linkSolutionToIssue(WS, SOL, ISSUE, { verdict: "pass", holdsPct: 90, note: "" })).toEqual({ status: "error", message: "That solution is already linked to this issue." });
  });

  it("refuses when signed out or given something that isn't an id", async () => {
    expect(await linkSolutionToIssue("x", SOL, ISSUE, { verdict: null, holdsPct: null, note: "" })).toMatchObject({ status: "error" });
    db.signedIn = false;
    expect(await linkSolutionToIssue(WS, SOL, ISSUE, { verdict: null, holdsPct: null, note: "" })).toMatchObject({ status: "error", message: "Your session has ended. Sign in again." });
  });
});
