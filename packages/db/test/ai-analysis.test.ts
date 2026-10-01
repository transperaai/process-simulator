import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_REVISION_ID, NORTHBEAM_WORKSPACE_ID } from "../src";
import { createTestDb, createUser, type TestDb } from "./harness";

// AI analysis storage (issue #111, A46): five switches per workspace and one analysis per process version. Every member
// reads; owners and editors write as themselves (no SECURITY DEFINER, no service key); anon has nothing; no one reaches
// another workspace's rows; a version's analysis can't name another process's revision.

const ws = NORTHBEAM_WORKSPACE_ID;
const proc = NORTHBEAM_PROCESS_ID;
const live = NORTHBEAM_REVISION_ID;
let db: TestDb;
let otherWs: string;
const users: Record<string, { id: string; claims: Record<string, unknown> }> = {};

const analysis = (c: pg.Client, revision = live, extra = "") =>
  c.query(
    `insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash ${extra ? ", " + extra.split("=")[0] : ""})
     values ($1, $2, $3, 'ok', 'publish', 'h1' ${extra ? ", " + extra.split("=").slice(1).join("=") : ""}) returning id`,
    [ws, proc, revision],
  );

beforeAll(async () => {
  db = await createTestDb();
  for (const role of ["owner", "editor", "member", "viewer"] as const) {
    users[role] = await createUser(db, `${role}@ai.example.com`);
    await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ws, users[role]!.id, role]);
  }
  users.stranger = await createUser(db, "stranger@ai.example.com");
  otherWs = (await db.client.query("insert into workspaces (name, slug) values ('Other', 'other-ai') returning id")).rows[0].id;
  await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [otherWs, users.stranger!.id]);
});

afterAll(async () => {
  await db?.close();
});

describe("ai_settings", () => {
  it("has no row until someone saves, and a row defaults to the prototype's switches with reading sources off", async () => {
    expect((await db.client.query("select 1 from ai_settings")).rowCount).toBe(0);
    await db.as(users.editor!.claims, async (c) => {
      await c.query("insert into ai_settings (workspace_id) values ($1)", [ws]);
      expect((await c.query("select review_on_publish, review_on_market, suggest_issues, suggest_solutions, read_sources from ai_settings")).rows[0]).toEqual({
        review_on_publish: true,
        review_on_market: true,
        suggest_issues: true,
        suggest_solutions: true,
        read_sources: false,
      });
    });
  });

  it("changes one switch without touching the others (the app's one-column upsert)", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await c.query("insert into ai_settings (workspace_id, suggest_issues) values ($1, false) on conflict (workspace_id) do update set suggest_issues = excluded.suggest_issues", [ws]);
      await c.query("insert into ai_settings (workspace_id, read_sources) values ($1, true) on conflict (workspace_id) do update set read_sources = excluded.read_sources", [ws]);
      expect((await c.query("select review_on_publish, suggest_issues, read_sources from ai_settings")).rows[0]).toEqual({ review_on_publish: true, suggest_issues: false, read_sources: true });
    });
  });

  it("lets every member read and only owners and editors write", async () => {
    await db.client.query("insert into ai_settings (workspace_id, review_on_market) values ($1, false)", [ws]);
    for (const role of ["owner", "editor", "member", "viewer"]) {
      const rows = await db.as(users[role]!.claims, async (c) => (await c.query("select review_on_market from ai_settings")).rows);
      expect(rows, role).toEqual([{ review_on_market: false }]);
    }
    for (const role of ["owner", "editor"]) {
      await db.as(users[role]!.claims, async (c) => {
        expect((await c.query("update ai_settings set review_on_market = true")).rowCount, role).toBe(1);
      });
    }
    for (const role of ["member", "viewer"]) {
      await db.as(users[role]!.claims, async (c) => {
        expect((await c.query("update ai_settings set review_on_market = true")).rowCount, role).toBe(0);
      });
      await db.as(users[role]!.claims, async (c) => {
        await expect(c.query("delete from ai_settings"), role).resolves.toMatchObject({ rowCount: 0 });
      });
    }
    await db.client.query("delete from ai_settings");
  });

  it("hides another workspace's switches and stops its members writing here", async () => {
    await db.client.query("insert into ai_settings (workspace_id) values ($1)", [ws]);
    await db.as(users.stranger!.claims, async (c) => {
      expect((await c.query("select 1 from ai_settings")).rowCount).toBe(0);
      expect((await c.query("update ai_settings set read_sources = true")).rowCount).toBe(0);
    });
    await db.as(users.stranger!.claims, async (c) => {
      await expect(c.query("insert into ai_settings (workspace_id) values ($1)", [randomUUID()])).rejects.toThrow(/row-level security|foreign key/);
    });
    await db.client.query("delete from ai_settings");
  });

  it("goes with its workspace", async () => {
    const w = (await db.client.query("insert into workspaces (name, slug) values ('Gone', 'gone-ai') returning id")).rows[0].id;
    await db.client.query("insert into ai_settings (workspace_id) values ($1)", [w]);
    await db.client.query("delete from workspaces where id = $1", [w]);
    expect((await db.client.query("select 1 from ai_settings where workspace_id = $1", [w])).rowCount).toBe(0);
  });
});

describe("ai_analyses: shape", () => {
  it("defaults to an empty read, no insights and no review", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await analysis(c);
      expect((await c.query("select summary, insights, review, checked, dropped, usage, trigger, status from ai_analyses")).rows[0]).toEqual({
        summary: [],
        insights: [],
        review: [],
        checked: 0,
        dropped: 0,
        usage: [],
        trigger: "publish",
        status: "ok",
      });
    });
  });

  it("holds one analysis per version, which a re-run replaces", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await analysis(c);
      await expect(analysis(c)).rejects.toThrow(/ai_analyses_revision_id_key/);
    });
    await db.as(users.editor!.claims, async (c) => {
      await analysis(c);
      await c.query(
        `insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash, summary)
         values ($1, $2, $3, 'ok', 'manual', 'h2', '["New read."]') on conflict (revision_id) do update set summary = excluded.summary, trigger = excluded.trigger, input_hash = excluded.input_hash`,
        [ws, proc, live],
      );
      expect((await c.query("select summary, trigger, input_hash from ai_analyses")).rows).toEqual([{ summary: ["New read."], trigger: "manual", input_hash: "h2" }]);
    });
  });

  it("checks the status, the trigger and the kind and size of each JSON part", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await c.query("savepoint a");
      await expect(c.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'great', 'publish', 'h')", [ws, proc, live])).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(c.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'ok', 'cron', 'h')", [ws, proc, live])).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(analysis(c, live, "summary='{}'::jsonb")).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(analysis(c, live, "insights=(select jsonb_agg(1) from generate_series(1, 31))")).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(analysis(c, live, "review=(select jsonb_agg(1) from generate_series(1, 41))")).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(analysis(c, live, "summary=(select jsonb_agg(repeat('x', 10000)) from generate_series(1, 8))")).rejects.toThrow(/check/);
      await c.query("rollback to a");
      await expect(analysis(c, live, "checked=-1")).rejects.toThrow(/check/);
    });
  });

  it("ties a row's revision to its process: another process's revision is refused", async () => {
    const other = (await db.client.query("select id, live_revision_id from processes where workspace_id = $1 and id <> $2 and live_revision_id is not null limit 1", [ws, proc])).rows[0];
    expect(other, "the seed has a second process").toBeTruthy();
    await expect(analysis(db.client, other.live_revision_id)).rejects.toThrow(/ai_analyses_revision_id_process_id_workspace_id_fkey/);
    await expect(
      db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'ok', 'publish', 'h')", [otherWs, proc, live]),
    ).rejects.toThrow(/violates foreign key/);
  });

  it("goes with its revision, and keeps updated_at moving", async () => {
    await db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'ok', 'publish', 'h')", [ws, proc, live]);
    const before = (await db.client.query("select updated_at from ai_analyses")).rows[0].updated_at as Date;
    await db.client.query("select pg_sleep(0.01)");
    await db.client.query("update ai_analyses set status = 'failed'");
    expect(((await db.client.query("select updated_at from ai_analyses")).rows[0].updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
    await db.client.query("delete from ai_analyses");
  });

  it("takes an analysis of an earlier version too (history keeps what AI said then)", async () => {
    const draft = (await db.client.query("select public.open_draft($1) as r", [proc])).rows[0].r as { revision_id: string };
    await db.client.query("select public.publish_process($1, true)", [proc]);
    try {
      await analysis(db.client, live);
      await analysis(db.client, draft.revision_id);
      expect((await db.client.query("select count(*)::int as n from ai_analyses")).rows[0].n).toBe(2);
    } finally {
      await db.client.query("delete from ai_analyses");
    }
  });
});

describe("ai_analyses: row-level security", () => {
  it("lets owners and editors write as themselves", async () => {
    for (const role of ["owner", "editor"]) {
      await db.as(users[role]!.claims, async (c) => {
        expect((await analysis(c)).rowCount, role).toBe(1);
        expect((await c.query("update ai_analyses set reason = 'x'")).rowCount, role).toBe(1);
        expect((await c.query("delete from ai_analyses")).rowCount, role).toBe(1);
      });
    }
  });

  it("lets every member read it", async () => {
    await db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash, summary) values ($1, $2, $3, 'ok', 'publish', 'h', '[\"Visible\"]')", [ws, proc, live]);
    try {
      for (const role of ["owner", "editor", "member", "viewer"]) {
        const rows = await db.as(users[role]!.claims, async (c) => (await c.query("select summary from ai_analyses")).rows);
        expect(rows, role).toEqual([{ summary: ["Visible"] }]);
      }
    } finally {
      await db.client.query("delete from ai_analyses");
    }
  });

  it("stops members and viewers writing", async () => {
    await db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash, summary) values ($1, $2, $3, 'ok', 'publish', 'h', '[\"Kept\"]')", [ws, proc, live]);
    try {
      for (const role of ["member", "viewer"]) {
        await db.as(users[role]!.claims, async (c) => {
          expect((await c.query("update ai_analyses set summary = '[\"x\"]'")).rowCount, role).toBe(0);
          expect((await c.query("delete from ai_analyses")).rowCount, role).toBe(0);
        });
        await db.as(users[role]!.claims, async (c) => {
          await expect(analysis(c), role).rejects.toThrow(/row-level security|violates unique/);
        });
      }
      expect((await db.client.query("select summary from ai_analyses")).rows).toEqual([{ summary: ["Kept"] }]);
    } finally {
      await db.client.query("delete from ai_analyses");
    }
  });

  it("hides another workspace's analyses, and stops its members writing into this one", async () => {
    await db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'ok', 'publish', 'h')", [ws, proc, live]);
    try {
      await db.as(users.stranger!.claims, async (c) => {
        expect((await c.query("select 1 from ai_analyses")).rowCount).toBe(0);
        expect((await c.query("update ai_analyses set reason = 'x'")).rowCount).toBe(0);
        expect((await c.query("delete from ai_analyses")).rowCount).toBe(0);
      });
      await db.as(users.stranger!.claims, async (c) => {
        await expect(analysis(c)).rejects.toThrow(/row-level security|violates unique/);
      });
    } finally {
      await db.client.query("delete from ai_analyses");
    }
  });

  it("gives anon nothing", async () => {
    await db.client.query("insert into ai_analyses (workspace_id, process_id, revision_id, status, trigger, input_hash) values ($1, $2, $3, 'ok', 'publish', 'h')", [ws, proc, live]);
    try {
      await db.client.query("begin");
      await db.client.query("set local role anon");
      await expect(db.client.query("select 1 from ai_analyses")).rejects.toThrow(/permission denied/);
      await db.client.query("rollback");
      await db.client.query("begin");
      await db.client.query("set local role anon");
      await expect(db.client.query("select 1 from ai_settings")).rejects.toThrow(/permission denied/);
      await db.client.query("rollback");
    } finally {
      await db.client.query("delete from ai_analyses");
    }
  });

  it("defines no SECURITY DEFINER function of its own (the server writes as the user)", async () => {
    const rows = (
      await db.client.query(
        "select proname from pg_proc where prosecdef and pronamespace in ('public'::regnamespace, 'private'::regnamespace) and (proname like 'ai\\_%' or prosrc ilike '%ai_analyses%' or prosrc ilike '%ai_settings%')",
      )
    ).rows;
    expect(rows).toEqual([]);
  });
});
