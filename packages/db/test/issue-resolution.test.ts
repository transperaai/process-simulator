import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_WORKSPACE_ID, northbeamIssues } from "../src";
import { createTestDb, createUser, type TestDb } from "./harness";

// A48: resolving an issue records how it was resolved and a note; the history keeps them; reopening clears the issue's
// own copy and logs.

let db: TestDb;
const users: Record<string, { id: string; claims: Record<string, unknown> }> = {};
const ws = NORTHBEAM_WORKSPACE_ID;
const target = northbeamIssues()[2]!.id;

beforeAll(async () => {
  db = await createTestDb();
  for (const role of ["editor", "viewer"] as const) {
    users[role] = await createUser(db, `${role}@northbeam.example`);
    await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ws, users[role]!.id, role]);
  }
});
afterAll(async () => {
  await db?.close();
});

type Client = pg.Client;
const resolve = async (c: Client, id: string, how: string, note: string | null = null, status = "resolved") =>
  (await c.query("select public.resolve_issue($1, $2, $3, $4, $5) as r", [ws, id, how, note, status])).rows[0].r as Record<string, unknown>;
const reopen = async (c: Client, id: string) =>
  (await c.query("select public.save_issue($1, $2, $3) as r", [ws, JSON.stringify({ status: "open" }), id])).rows[0].r as Record<string, unknown>;
const events = async (c: Client, id: string) => (await c.query("select kind, actor, detail from issue_events where issue_id = $1 order by seq", [id])).rows;

describe("resolve_issue", () => {
  it("resolves with how and a note, and logs one resolved entry carrying both", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await resolve(c, target, "process_change", "  We removed the call.  ");
      expect(r).toMatchObject({ status: "done", resolution: null, resolved_how: "process_change", resolution_note: "We removed the call." });
      expect(r.resolved_at).not.toBeNull();
      const log = await events(c, target);
      expect(log.at(-1)).toMatchObject({ kind: "resolved", actor: users.editor!.id, detail: { from: "open", to: "resolved", how: "process_change", note: "We removed the call." } });
      expect(log.filter((e) => e.kind === "resolved")).toHaveLength(1);
    });
  });

  it("leaves out an empty note, and can mark won't fix", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await resolve(c, target, "not_a_problem", "   ", "wont_fix");
      const log = await events(c, target);
      expect(log.at(-1)!.detail).toEqual({ from: "open", to: "wont_fix", how: "not_a_problem" });
    });
  });

  it("reopening clears the issue's how and note, logs reopened, and keeps the resolved entry", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await resolve(c, target, "solution", "Lead scoring fixed it");
      const r = await reopen(c, target);
      expect(r).toMatchObject({ status: "open", resolved_how: null, resolution_note: null, resolved_at: null });
      const log = await events(c, target);
      expect(log.map((e) => e.kind)).toEqual(["created", "resolved", "reopened"]);
      expect(log[1]!.detail).toMatchObject({ how: "solution", note: "Lead scoring fixed it" });
      expect(log[2]!.detail).toEqual({ from: "resolved", to: "open" });
    });
  });

  it("refuses a viewer, a bad how or status, an unknown issue, and a note over 2000 characters", async () => {
    await db.as(users.viewer!.claims, async (c) => {
      await expect(resolve(c, target, "solution")).rejects.toThrow(/cannot change issues/);
    });
    await db.as(users.editor!.claims, async (c) => {
      for (const run of [
        () => resolve(c, target, "magic"),
        () => resolve(c, target, "solution", null, "open"),
        () => resolve(c, "00000000-0000-0000-0000-000000000000", "solution"),
        () => resolve(c, target, "solution", "x".repeat(2001)),
      ]) {
        await c.query("savepoint s");
        await expect(run()).rejects.toThrow();
        await c.query("rollback to savepoint s");
      }
    });
  });

  it("the table check rejects a how that is not one of the three", async () => {
    await expect(db.client.query("update issues set status = 'done', resolved_how = 'because' where id = $1", [target])).rejects.toThrow(/issues_resolved_how_check/);
  });
});
