import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_WORKSPACE_ID, northbeamIssues, northbeamStepIds } from "../src";
import { createTestDb, createUser, type TestDb } from "./harness";

// Suggestions v2 (issue #117, A52 slice 1; docs/PRD.md §7.1c): proposed issues and solution ideas wait in
// `suggestion_proposals`. Accepting a proposed issue creates it through `save_issue` (the Acknowledge path), rejecting
// one creates nothing, a solution idea can only be dismissed for now, and the MCP server can propose but never
// review. Row-level security and the decision-column guard are checked as the users who meet them.

let db: TestDb;
const users: Record<string, { id: string; claims: Record<string, unknown> }> = {};
const ws = NORTHBEAM_WORKSPACE_ID;
const [openIssue] = northbeamIssues().map((i) => i.id) as [string];
const aStep = Object.values(northbeamStepIds)[0] as string;
/** An editor's API token, as the MCP server's requests carry it (docs/adr/0002-*). */
const mcp = () => ({ ...users.editor!.claims, api_token_id: randomUUID() });

beforeAll(async () => {
  db = await createTestDb();
  for (const role of ["owner", "editor", "member", "viewer"] as const) {
    users[role] = await createUser(db, `${role}@proposals.example.com`);
    await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ws, users[role]!.id, role]);
  }
  users.stranger = await createUser(db, "stranger@proposals.example.com");
});

afterAll(async () => {
  await db?.close();
});

const one = async (c: pg.Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];

async function propose(
  c: pg.Client,
  kind: "issue" | "solution_idea",
  fields: { title?: string; detail?: string; payload?: unknown; issue_id?: string | null; extra?: string } = {},
) {
  return (
    await c.query(
      "insert into suggestion_proposals (workspace_id, kind, title, detail, payload, issue_id) values ($1, $2, $3, $4, $5, $6) returning *",
      [
        ws,
        kind,
        fields.title ?? "Ad-hoc requests wait 20 h for an SEO specialist",
        fields.detail ?? "Seen in the 30 Sep call.",
        JSON.stringify(fields.payload ?? (kind === "issue" ? { severity: "warning", links: [{ process_id: NORTHBEAM_PROCESS_ID, step_id: null }] } : { steps: [{ key: "a", name: "Fast-track" }] })),
        kind === "solution_idea" ? (fields.issue_id === undefined ? openIssue : fields.issue_id) : null,
      ],
    )
  ).rows[0];
}

type Review = { id: string; status: string; message?: string; code?: string; applied?: { issue_id: string; number: number } };
const review = async (c: pg.Client, ids: string[], decision: "accept" | "reject", note?: string): Promise<Review[]> =>
  (await c.query("select public.review_proposals($1::uuid[], $2, $3) as r", [ids, decision, note ?? null])).rows[0].r;

describe("proposing", () => {
  it("the MCP server (an editor's token) creates a pending proposal and writes no issue", async () => {
    await db.as(mcp(), async (c) => {
      const issuesBefore = (await one(c, "select count(*)::int as n from issues")).n;
      const p = (
        await c.query(
          "insert into suggestion_proposals (workspace_id, kind, title, payload, status, reviewed_at, created_via, proposer_name) values ($1, 'issue', 'X', '{}', 'accepted', now(), 'play_link', 'Visitor') returning *",
          [ws],
        )
      ).rows[0];
      // Forced: pending, by the token's user, as the MCP server, with no visitor's name.
      expect(p).toMatchObject({ status: "pending", reviewed_at: null, created_by: users.editor!.id, created_via: "mcp", proposer_name: null, applied: null });
      expect((await one(c, "select count(*)::int as n from issues")).n).toBe(issuesBefore);
    });
  });

  it("everyone in the workspace reads proposals; members and viewers can't make them; strangers see none", async () => {
    for (const role of ["member", "viewer"]) {
      await expect(db.as(users[role]!.claims, (c) => propose(c, "issue")), role).rejects.toThrow(/row-level security/);
    }
    await db.client.query("insert into suggestion_proposals (workspace_id, kind, title) values ($1, 'issue', 'Seen by all')", [ws]);
    for (const role of ["owner", "editor", "member", "viewer"]) {
      expect((await db.as(users[role]!.claims, async (c) => (await one(c, "select count(*)::int as n from suggestion_proposals")).n)), role).toBeGreaterThan(0);
    }
    expect(await db.as(users.stranger!.claims, async (c) => (await one(c, "select count(*)::int as n from suggestion_proposals")).n)).toBe(0);
    await db.client.query("delete from suggestion_proposals");
  });

  it("a proposal can't be edited, decided directly or deleted", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const p = await propose(c, "issue");
      await c.query("savepoint a");
      await expect(c.query("update suggestion_proposals set title = 'Other' where id = $1", [p.id])).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint a");
      await expect(c.query("update suggestion_proposals set status = 'accepted', reviewed_at = now() where id = $1", [p.id])).rejects.toThrow(/review_proposals/);
      await c.query("rollback to savepoint a");
      await expect(c.query("delete from suggestion_proposals where id = $1", [p.id])).rejects.toThrow(/permission denied/);
    });
  });

  it("keeps the shape: a solution idea needs its issue and steps, a proposed issue has no issue_id", async () => {
    await db.as(users.editor!.claims, async (c) => {
      for (const [sql, params] of [
        ["insert into suggestion_proposals (workspace_id, kind, title, payload) values ($1, 'solution_idea', 'No issue', '{\"steps\": []}')", [ws]],
        ["insert into suggestion_proposals (workspace_id, kind, title, issue_id, payload) values ($1, 'solution_idea', 'No steps', $2, '{}')", [ws, openIssue]],
        ["insert into suggestion_proposals (workspace_id, kind, title, issue_id) values ($1, 'issue', 'Has an issue', $2)", [ws, openIssue]],
        ["insert into suggestion_proposals (workspace_id, kind, title) values ($1, 'issue', '   ')", [ws]],
        ["insert into suggestion_proposals (workspace_id, kind, title) values ($1, 'other', 'X')", [ws]],
      ] as const) {
        await c.query("savepoint s");
        await expect(c.query(sql, [...params]), sql).rejects.toThrow(/violates check constraint/);
        await c.query("rollback to savepoint s");
      }
    });
  });

  it("a solution idea goes when its issue does (the foreign key keeps it inside the workspace)", async () => {
    const issue = (await db.client.query("insert into issues (workspace_id, type, title) values ($1, 'manual', 'Temp') returning id", [ws])).rows[0].id;
    await db.client.query("insert into suggestion_proposals (workspace_id, kind, title, issue_id, payload) values ($1, 'solution_idea', 'Idea', $2, '{\"steps\": []}')", [ws, issue]);
    await db.client.query("delete from issues where id = $1", [issue]);
    expect((await db.client.query("select count(*)::int as n from suggestion_proposals where title = 'Idea'")).rows[0].n).toBe(0);
  });
});

describe("accepting a proposed issue", () => {
  it("creates the issue through save_issue: numbered, linked, with a created entry in its history", async () => {
    const accepted = await db.as(users.editor!.claims, async (c) => {
      const p = await propose(c, "issue", {
        title: "Clients wait 20 hours for answers",
        detail: "Said on the 30 Sep call.",
        payload: {
          severity: "serious",
          type: "delay",
          links: [{ process_id: NORTHBEAM_PROCESS_ID, step_id: aStep }],
          target_measure: "Wait at Ad-hoc requests",
          target_now: "20 h",
          target_goal: "under 8 h",
        },
      });
      const [r] = await review(c, [p.id], "accept", "Agreed");
      expect(r).toMatchObject({ id: p.id, status: "accepted" });
      const issue = await one(c, "select * from issues where id = $1", [r!.applied!.issue_id]);
      expect(issue).toMatchObject({
        title: "Clients wait 20 hours for answers",
        type: "delay",
        severity: "serious",
        evidence: "Said on the 30 Sep call.",
        status: "open",
        source: "manual",
        target_measure: "Wait at Ad-hoc requests",
        target_now: "20 h",
        target_goal: "under 8 h",
        created_by: users.editor!.id,
      });
      expect(issue.number).toBe(r!.applied!.number);
      expect(issue.number).toBeGreaterThan(0);
      expect((await c.query("select process_id, step_id from issue_links where issue_id = $1", [issue.id])).rows).toEqual([{ process_id: NORTHBEAM_PROCESS_ID, step_id: aStep }]);
      expect((await c.query("select kind, actor from issue_events where issue_id = $1 order by seq", [issue.id])).rows).toEqual([{ kind: "created", actor: users.editor!.id }]);
      expect(await one(c, "select status, review_note, reviewed_by, applied from suggestion_proposals where id = $1", [p.id])).toMatchObject({
        status: "accepted",
        review_note: "Agreed",
        reviewed_by: users.editor!.id,
        applied: { issue_id: issue.id, number: issue.number },
      });
      return issue.id as string;
    });
    expect(accepted).toBeTruthy();
  });

  it("defaults to a manual issue rated Good, could improve, when the proposal gives neither", async () => {
    await db.as(users.owner!.claims, async (c) => {
      const p = await propose(c, "issue", { payload: {} });
      const [r] = await review(c, [p.id], "accept");
      expect(await one(c, "select type, severity from issues where id = $1", [r!.applied!.issue_id])).toEqual({ type: "manual", severity: "warning" });
    });
  });

  it("leaves a proposal it can't turn into an issue pending, and creates nothing", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const before = (await one(c, "select count(*)::int as n from issues")).n;
      const p = await propose(c, "issue", { payload: { links: [{ process_id: NORTHBEAM_PROCESS_ID, step_id: randomUUID() }] } });
      const [r] = await review(c, [p.id], "accept");
      expect(r).toMatchObject({ id: p.id, status: "failed", code: "22023" });
      expect((await one(c, "select count(*)::int as n from issues")).n).toBe(before);
      expect(await one(c, "select status, reviewed_at from suggestion_proposals where id = $1", [p.id])).toEqual({ status: "pending", reviewed_at: null });
    });
  });

  it("doesn't create the issue again when reviewed twice", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const p = await propose(c, "issue", { payload: {} });
      const [first] = await review(c, [p.id], "accept");
      const issues = (await one(c, "select count(*)::int as n from issues")).n;
      const [again] = await review(c, [p.id], "accept");
      expect(first!.status).toBe("accepted");
      expect(again).toMatchObject({ status: "already_reviewed", current: "accepted" });
      expect((await one(c, "select count(*)::int as n from issues")).n).toBe(issues);
    });
  });
});

describe("rejecting and dismissing", () => {
  it("rejecting a proposed issue records it, with the reason, and creates no issue", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const before = (await one(c, "select count(*)::int as n from issues")).n;
      const p = await propose(c, "issue");
      const [r] = await review(c, [p.id], "reject", "  Not a real problem ");
      expect(r).toEqual({ id: p.id, status: "rejected" });
      expect(await one(c, "select status, review_note, reviewed_by, applied from suggestion_proposals where id = $1", [p.id])).toEqual({
        status: "rejected",
        review_note: "Not a real problem",
        reviewed_by: users.editor!.id,
        applied: null,
      });
      expect((await one(c, "select count(*)::int as n from issues")).n).toBe(before);
    });
  });

  it("a solution idea is dismissed, never accepted (building it is the Editor's job, slice 2)", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const solutions = (await one(c, "select count(*)::int as n from solutions")).n;
      const idea = await propose(c, "solution_idea");
      const [accept] = await review(c, [idea.id], "accept");
      expect(accept).toMatchObject({ status: "failed", message: expect.stringMatching(/built in the Editor/) });
      expect((await one(c, "select status from suggestion_proposals where id = $1", [idea.id])).status).toBe("pending");
      const [dismiss] = await review(c, [idea.id], "reject");
      expect(dismiss).toEqual({ id: idea.id, status: "dismissed" });
      expect((await one(c, "select count(*)::int as n from solutions")).n).toBe(solutions);
    });
  });

  it("handles each proposal on its own in one call", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const good = await propose(c, "issue", { payload: {} });
      const bad = await propose(c, "solution_idea");
      const gone = randomUUID();
      const results = await review(c, [good.id, bad.id, gone], "accept");
      expect(results.map((r) => r.status)).toEqual(["accepted", "failed", "not_found"]);
    });
  });
});

describe("who can review", () => {
  it("only owners and editors; others find nothing to review, and the proposal stays pending", async () => {
    const p = (await db.client.query("insert into suggestion_proposals (workspace_id, kind, title) values ($1, 'issue', 'Waiting') returning id", [ws])).rows[0].id;
    for (const role of ["member", "viewer", "stranger"]) {
      const [r] = await db.as(users[role]!.claims, (c) => review(c, [p], "reject"));
      expect(r!.status, role).toBe("not_found");
    }
    expect((await db.client.query("select status from suggestion_proposals where id = $1", [p])).rows[0].status).toBe("pending");
    const [r] = await db.as(users.owner!.claims, (c) => review(c, [p], "reject"));
    expect(r!.status).toBe("rejected");
  });

  it("the MCP server can't review: a person decides", async () => {
    const p = (await db.client.query("insert into suggestion_proposals (workspace_id, kind, title) values ($1, 'issue', 'Waiting too') returning id", [ws])).rows[0].id;
    await expect(db.as(mcp(), (c) => review(c, [p], "accept"))).rejects.toThrow(/by a person in the app/);
    expect((await db.client.query("select status from suggestion_proposals where id = $1", [p])).rows[0].status).toBe("pending");
  });

  it("checks its input", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await c.query("savepoint s");
      await expect(c.query("select public.review_proposals(array[$1::uuid], 'maybe')", [randomUUID()])).rejects.toThrow(/accept or reject/);
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.review_proposals('{}'::uuid[], 'accept')")).rejects.toThrow(/between 1 and 500/);
    });
  });
});
