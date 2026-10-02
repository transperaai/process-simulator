import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions the Solution page calls (issue #115, A50): your verdict and note on a link, and the notes on a solution.
// They write as the signed-in user; row-level security decides who may (an editor changes a row, anyone else changes none and is told).

const db = vi.hoisted(() => ({
  signedIn: true,
  calls: [] as { op: string; args: unknown[] }[],
  result: { data: [] as unknown[], error: null as { code?: string } | null },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = {
      update: (...args: unknown[]) => (db.calls.push({ op: "update", args }), chain),
      eq: (...args: unknown[]) => (db.calls.push({ op: "eq", args }), chain),
      select: () => chain,
      then: (resolve: (v: unknown) => void) => resolve(db.result),
    };
    return {
      auth: { getClaims: async () => ({ data: db.signedIn ? { claims: { sub: "u1" } } : null }) },
      from: (table: string) => (db.calls.push({ op: "from", args: [table] }), chain),
    };
  },
}));
const { saveSolutionNotes, saveSolutionVerdict } = await import("@/app/w/[slug]/solution-page-actions");

const WS = "a0000000-0000-4000-8000-000000000001";
const SOL = "5f1c2b4a-0000-4000-8000-000000000009";
const ISSUE = "3f1c2b4a-0000-4000-8000-000000000001";
const row = { solution_id: SOL, issue_id: ISSUE, user_verdict: "pass", user_notes: "Fine" };
const updates = () => db.calls.filter((c) => c.op === "update").map((c) => c.args[0]);

beforeEach(() => {
  db.signedIn = true;
  db.calls = [];
  db.result = { data: [row], error: null };
});

describe("saveSolutionVerdict", () => {
  it("saves a pass, a fail or a cleared verdict on that solution and issue only", async () => {
    for (const v of ["pass", "fail", null]) {
      db.calls = [];
      expect((await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: v })).status).toBe("ok");
      expect(updates()).toEqual([{ user_verdict: v }]);
      expect(db.calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["solution_id", SOL], ["issue_id", ISSUE], ["workspace_id", WS]]);
      expect(db.calls.find((c) => c.op === "from")!.args[0]).toBe("solution_issues");
    }
  });

  it("saves your note with it, or on its own, and never touches the automatic verdict", async () => {
    await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "fail", notes: "Too slow" });
    expect(updates()).toEqual([{ user_verdict: "fail", user_notes: "Too slow" }]);
    // A note on its own does not write the verdict, and a verdict on its own does not write the note.
    db.calls = [];
    await saveSolutionVerdict(WS, SOL, ISSUE, { notes: "Only a note" });
    expect(updates()).toEqual([{ user_notes: "Only a note" }]);
    db.calls = [];
    await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "pass" });
    expect(updates()).toEqual([{ user_verdict: "pass" }]);
    expect(JSON.stringify(updates())).not.toContain("auto_");
  });

  it("refuses anything that isn't a pass, a fail or nothing, an id that isn't one, and a note that is too long", async () => {
    expect((await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "maybe" })).status).toBe("error");
    expect((await saveSolutionVerdict(WS, SOL, "nope", { verdict: "pass" })).status).toBe("error");
    expect((await saveSolutionVerdict(WS, SOL, ISSUE, { notes: "x".repeat(4001) })).status).toBe("error");
    expect((await saveSolutionVerdict(WS, SOL, ISSUE, {})).status).toBe("error");
    expect(db.calls).toEqual([]);
  });

  it("says so when no row changed (a viewer, or a solution that is gone) and when the session has ended", async () => {
    db.result = { data: [], error: null };
    expect(await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "pass" })).toEqual({ status: "error", message: expect.stringMatching(/permission/) });
    db.result = { data: [], error: { code: "42501" } };
    expect((await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "pass" })).status).toBe("error");
    db.signedIn = false;
    expect(await saveSolutionVerdict(WS, SOL, ISSUE, { verdict: "pass" })).toEqual({ status: "error", message: expect.stringMatching(/session has ended/) });
  });
});

describe("saveSolutionNotes", () => {
  it("saves the notes on the solution", async () => {
    db.result = { data: [{ notes: "Needs a trial" }], error: null };
    expect(await saveSolutionNotes(WS, SOL, "Needs a trial")).toEqual({ status: "ok", notes: "Needs a trial" });
    expect(updates()).toEqual([{ notes: "Needs a trial" }]);
    expect(db.calls.find((c) => c.op === "from")!.args[0]).toBe("solutions");
  });

  it("refuses notes that are too long, and says so when no row changed", async () => {
    expect((await saveSolutionNotes(WS, SOL, "x".repeat(4001))).status).toBe("error");
    expect((await saveSolutionNotes(WS, SOL, 5)).status).toBe("error");
    db.result = { data: [], error: null };
    expect((await saveSolutionNotes(WS, SOL, "ok")).status).toBe("error");
  });
});
