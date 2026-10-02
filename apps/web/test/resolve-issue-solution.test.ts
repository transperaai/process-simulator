import { describe, expect, it } from "vitest";
import { resolveIssue, type Db } from "@transpera-flow/db";

// Resolving with a solution (issue #115, A50): the app calls the six-argument resolve_issue only when a solution was picked, and
// the five-argument one otherwise, so resolving works before and after the migration that adds the sixth argument.

const fake = (result: { data: unknown; error: { code?: string; message?: string } | null } = { data: { id: "i1" }, error: null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), result) } as unknown as Db;
  return { db, calls };
};
const base = { workspaceId: "w1", id: "i1" };

describe("resolveIssue", () => {
  it("names the solution with the six-argument function", async () => {
    const { db, calls } = fake();
    expect(await resolveIssue(db, { ...base, how: "solution", note: "Built into Sales v8", solutionId: "s1" })).toEqual({ id: "i1" });
    expect(calls).toEqual([
      { fn: "resolve_issue", args: { p_workspace: "w1", p_id: "i1", p_how: "solution", p_status: "resolved", p_note: "Built into Sales v8", p_solution: "s1" } },
    ]);
  });

  it("sends an empty note, not a missing one, so the six-argument function is the only match", async () => {
    const { db, calls } = fake();
    await resolveIssue(db, { ...base, how: "solution", solutionId: "s1" });
    expect(calls[0]!.args).toMatchObject({ p_note: "", p_solution: "s1" });
  });

  it("uses the five-argument function when no solution is named, exactly as before", async () => {
    const { db, calls } = fake();
    await resolveIssue(db, { ...base, how: "process_change", note: "We removed the call" });
    await resolveIssue(db, { ...base, how: "solution", solutionId: null });
    expect(calls.map((c) => Object.keys(c.args).sort())).toEqual([
      ["p_how", "p_id", "p_note", "p_status", "p_workspace"],
      ["p_how", "p_id", "p_note", "p_status", "p_workspace"],
    ]);
    expect(calls.some((c) => "p_solution" in c.args)).toBe(false);
  });

  it("hands back the database's error", async () => {
    const { db } = fake({ data: null, error: { code: "22023", message: "resolve_issue: that solution is not linked to this issue" } });
    expect(await resolveIssue(db, { ...base, how: "solution", solutionId: "s1" })).toEqual({ error: { code: "22023", message: expect.stringMatching(/not linked/) } });
  });
});
