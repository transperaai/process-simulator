import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_WORKSPACE_ID, northbeamIssues, northbeamPersonIds, northbeamSourceIds, northbeamStepIds } from "../src";
import { createTestDb, createUser, type TestDb } from "./harness";

// Issues v2 (issue #112, A47): links to a process or several steps, several owners, targets, the four statuses, a
// stable number per workspace, linked sources, the history log, row-level security on the new tables, and the
// migration of what was already tracked.

const MIGRATION = "20261120000000_issues_v2.sql";
const dir = (p: string) => new URL(p, import.meta.url);
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

describe("migrating existing issues", () => {
  let client: pg.Client;
  let name: string;
  const ws = randomUUID();
  const proc = randomUUID();
  const rev = randomUUID();
  const stepA = randomUUID();
  const person = randomUUID();
  const source = randomUUID();
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
  let before: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    name = `transpera_flow_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await client.query(readFileSync(dir("./sql/auth-shim.sql"), "utf8"));
    // Everything before this migration: the schema as production has it.
    for (const f of readdirSync(dir("../supabase/migrations")).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) {
      await client.query(readFileSync(dir(`../supabase/migrations/${f}`), "utf8"));
    }
    await client.query("insert into workspaces (id, name, slug) values ($1, 'Old Co', 'old-co')", [ws]);
    await client.query("insert into processes (id, workspace_id, name) values ($1, $2, 'Pipeline')", [proc, ws]);
    await client.query("insert into process_revisions (id, workspace_id, process_id, number, status) values ($1, $2, $3, 1, 'draft')", [rev, ws, proc]);
    await client.query(
      "insert into steps (id, revision_id, workspace_id, process_id, name, kind, work_hours, x, y) values ($1, $2, $3, $4, 'Check fit', 'task', 1, 0, 0)",
      [stepA, rev, ws, proc],
    );
    await client.query("update process_revisions set status = 'published' where id = $1", [rev]);
    await client.query("update processes set live_revision_id = $1 where id = $2", [rev, proc]);
    await client.query("insert into people (id, workspace_id, name) values ($1, $2, 'Rosa')", [person, ws]);
    await client.query("insert into sources (id, workspace_id, title) values ($1, $2, 'Interview')", [source, ws]);
    const cites = JSON.stringify([{ source_id: source, speaker: "Rosa", quote: "q" }, { source_id: randomUUID(), quote: "a source that is gone" }]);
    const ins = (id: string, at: string, f: Record<string, unknown>) => {
      const row = { id, workspace_id: ws, type: "manual", created_at: at, ...f };
      const cols = Object.keys(row);
      return client.query(`insert into issues (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
    };
    // The step names no process; the issue is critical and in progress, owned, citing a source.
    await ins(ids.a, "2026-09-01T09:00:00Z", { step_id: stepA, severity: "critical", status: "in_progress", owner_person_id: person, evidence_sources: cites, title: "A" });
    await ins(ids.b, "2026-09-02T09:00:00Z", { process_id: proc, severity: "info", status: "done", title: "B" });
    await ins(ids.c, "2026-09-03T09:00:00Z", { process_id: proc, type: "spof", source: "promoted", detected_key: `spof:step:${stepA}`, severity: "serious", status: "dismissed", title: "C" });
    await ins(ids.d, "2026-09-04T09:00:00Z", { type: "idea", severity: "warning", status: "open", title: "D" });
    before = Object.fromEntries((await client.query("select * from issues")).rows.map((r) => [r.id, r]));
    await client.query(readFileSync(dir(`../supabase/migrations/${MIGRATION}`), "utf8"));
  });

  afterAll(async () => {
    await client?.end();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.end();
  });

  const after = async () => Object.fromEntries((await client.query("select * from issues")).rows.map((r) => [r.id, r]));

  it("loses nothing: every old column keeps its value, apart from the statuses that were renamed", async () => {
    const now = await after();
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    for (const [id, old] of Object.entries(before)) {
      const { status: _s, number: _n, target_measure: _a, target_now: _b, target_goal: _c, dismissed_revision_id: _d, ...rest } = now[id] as Record<string, unknown>;
      const { status: _os, ...oldRest } = old;
      expect(rest, id).toEqual(oldRest);
    }
  });

  it("maps statuses: in progress to testing, done to resolved; open and dismissed stay (dismissed stays hidden)", async () => {
    const now = await after();
    expect([ids.a, ids.b, ids.c, ids.d].map((i) => now[i].status)).toEqual(["testing", "resolved", "dismissed", "open"]);
    expect(now[ids.b].resolved_at).toEqual(before[ids.b]!.resolved_at);
    expect(now[ids.a].resolved_at).toBeNull();
  });

  it("keeps severities, which already hold the four ratings", async () => {
    const now = await after();
    expect([ids.a, ids.b, ids.c, ids.d].map((i) => now[i].severity)).toEqual(["critical", "info", "serious", "warning"]);
  });

  it("turns each step or process into a link, looking a step's process up", async () => {
    const links = (await client.query("select issue_id, process_id, step_id from issue_links order by issue_id")).rows;
    const of = (id: string) => links.filter((l) => l.issue_id === id).map(({ process_id, step_id }) => ({ process_id, step_id }));
    expect(of(ids.a)).toEqual([{ process_id: proc, step_id: stepA }]);
    expect(of(ids.b)).toEqual([{ process_id: proc, step_id: null }]);
    expect(of(ids.c)).toEqual([{ process_id: proc, step_id: null }]);
    expect(of(ids.d)).toEqual([]);
  });

  it("turns the owner into an owner row, and the cited source that still exists into a source row", async () => {
    expect((await client.query("select issue_id, person_id from issue_owners")).rows).toEqual([{ issue_id: ids.a, person_id: person }]);
    expect((await client.query("select issue_id, source_id from issue_sources")).rows).toEqual([{ issue_id: ids.a, source_id: source }]);
  });

  it("numbers the issues 1 to 3, oldest first, gives the dismissed insight none, and carries on from there", async () => {
    const now = await after();
    expect([ids.a, ids.b, ids.c, ids.d].map((i) => now[i].number)).toEqual([1, 2, null, 3]);
    const next = (await client.query("insert into issues (workspace_id, type, title) values ($1, 'idea', 'New') returning number", [ws])).rows[0].number;
    expect(next).toBe(4);
  });

  it("dismisses a migrated insight against its process's live revision, so it lasts until the next published version", async () => {
    const now = await after();
    expect(now[ids.c].dismissed_revision_id).toBe(rev);
    expect([ids.a, ids.b, ids.d].map((i) => now[i].dismissed_revision_id)).toEqual([null, null, null]);
  });

  it("starts each one's history: created, plus resolved for the closed one", async () => {
    const events = (await client.query("select issue_id, kind from issue_events where issue_id in ($1, $2, $3, $4) order by seq", [ids.a, ids.b, ids.c, ids.d])).rows;
    const kinds = (id: string) => events.filter((e) => e.issue_id === id).map((e) => e.kind);
    expect(kinds(ids.a)).toEqual(["created"]);
    expect(kinds(ids.b)).toEqual(["created", "resolved"]);
    expect(kinds(ids.c)).toEqual([]);
    expect(kinds(ids.d)).toEqual(["created"]);
  });
});

let db: TestDb;
let other: string;
const users: Record<string, { id: string; claims: Record<string, unknown> }> = {};
const ws = NORTHBEAM_WORKSPACE_ID;
const audit = northbeamStepIds.audit;
const rosa = northbeamPersonIds["Rosa Diaz"]!;
const priya = northbeamPersonIds["Priya Shah"]!;

beforeAll(async () => {
  db = await createTestDb();
  other = (await db.client.query("insert into workspaces (name, slug) values ('Other Co', 'other-co') returning id")).rows[0].id;
  users.admin = await createUser(db, "admin@agency.example", { agency_admin: true });
  for (const role of ["owner", "editor", "member", "viewer"] as const) {
    users[role] = await createUser(db, `${role}@northbeam.example`);
    await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ws, users[role]!.id, role]);
  }
  users.stranger = await createUser(db, "stranger@example.com");
});

afterAll(async () => {
  await db?.close();
});

type Client = pg.Client;
const save = async (c: Client, workspace: string, id: string | null, fields: Record<string, unknown>, links: unknown = null, owners: string[] | null = null, sources: string[] | null = null) =>
  (await c.query("select public.save_issue($1, $2, $3, $4, $5, $6) as r", [workspace, id, JSON.stringify(fields), links === null ? null : JSON.stringify(links), owners, sources])).rows[0].r as { id: string; number: number; type: string; [column: string]: unknown };
/** Expect `run` to fail with `pattern`, inside the caller's transaction (a savepoint keeps it usable). */
const fails = async (c: Client, run: () => Promise<unknown>, pattern: RegExp) => {
  await c.query("savepoint s");
  try {
    await expect(run()).rejects.toThrow(pattern);
  } finally {
    await c.query("rollback to savepoint s");
  }
};
const events = async (c: Client, id: string) => (await c.query("select kind, actor, detail, at from issue_events where issue_id = $1 order by seq", [id])).rows;
const kinds = async (c: Client, id: string) => (await events(c, id)).map((e) => e.kind as string);

describe("seed", () => {
  it("numbers Northbeam's issues like the fixtures, and links them", async () => {
    const rows = (await db.client.query("select id, number, status from issues where workspace_id = $1 order by number", [ws])).rows;
    expect(rows.map((r) => r.id)).toEqual(northbeamIssues().map((i) => i.id));
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.status)).toEqual(["open", "testing", "open"]);
    const first = northbeamIssues()[0]!;
    expect((await db.client.query("select step_id from issue_links where issue_id = $1", [first.id])).rows).toEqual([{ step_id: audit }]);
    expect((await db.client.query("select source_id from issue_sources where issue_id = $1", [first.id])).rows).toEqual([{ source_id: northbeamSourceIds.strategyInterview }]);
    expect((await db.client.query("select target_measure, target_now, target_goal from issues where id = $1", [first.id])).rows[0]).toEqual({
      target_measure: "Hands-on time per proposal",
      target_now: "6 hours",
      target_goal: "under 3 hours",
    });
  });
});

describe("save_issue", () => {
  it("creates an issue with steps, several owners, a target and sources, and the first of each fills the old columns", async () => {
    const r = await db.as(users.editor!.claims, (c) =>
      save(
        c,
        ws,
        null,
        { title: "Slow check", type: "delay", severity: "serious", target_measure: "Wait at Check fit", target_now: "1.4 d", target_goal: "under 4 hours" },
        [
          { process_id: NORTHBEAM_PROCESS_ID, step_id: audit },
          { process_id: NORTHBEAM_PROCESS_ID, step_id: northbeamStepIds.qualify },
        ],
        [rosa, priya],
        [northbeamSourceIds.salesNotes],
      ),
    );
    expect(r).toMatchObject({ title: "Slow check", status: "open", source: "manual", step_id: audit, process_id: NORTHBEAM_PROCESS_ID, owner_person_id: rosa, target_goal: "under 4 hours", created_by: users.editor!.id });
    expect(r.number).toBe(4);
  });

  it("links a whole process, which is a link with no step", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Whole process" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: null }]);
      expect((await c.query("select process_id, step_id from issue_links where issue_id = $1", [r.id])).rows).toEqual([{ process_id: NORTHBEAM_PROCESS_ID, step_id: null }]);
      expect(r).toMatchObject({ process_id: NORTHBEAM_PROCESS_ID, step_id: null });
    });
  });

  it("replaces links, owners and sources, writing only the differences", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Replace" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], [northbeamSourceIds.salesNotes]);
      await save(c, ws, r.id, {}, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: northbeamStepIds.qualify }], [priya, rosa], []);
      expect((await c.query("select step_id from issue_links where issue_id = $1", [r.id])).rows).toEqual([{ step_id: northbeamStepIds.qualify }]);
      expect((await c.query("select person_id from issue_owners where issue_id = $1", [r.id])).rows.map((x) => x.person_id).sort()).toEqual([priya, rosa].sort());
      expect((await c.query("select count(*)::int as n from issue_sources where issue_id = $1", [r.id])).rows[0].n).toBe(0);
      expect((await c.query("select step_id, owner_person_id from issues where id = $1", [r.id])).rows[0]).toEqual({ step_id: northbeamStepIds.qualify, owner_person_id: priya });
    });
  });

  it("refuses fields it doesn't set and an issue in another workspace, and needs a title to create", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await fails(c, () => save(c, ws, null, { title: "x", number: 99 }), /cannot be set/);
      await fails(c, () => save(c, ws, null, { title: "x", resolved_at: "2026-01-01" }), /cannot be set/);
      await fails(c, () => save(c, ws, null, { type: "idea" }), /title is required/);
      const r = await save(c, ws, null, { title: "Edit me" });
      expect(r.type).toBe("manual");
      await fails(c, () => save(c, ws, r.id, { source: "promoted" }), /cannot be set/);
      await fails(c, () => save(c, other, r.id, { title: "moved" }), /cannot change issues/);
    });
  });

  it("runs as the caller: members, viewers and strangers can't create or edit", async () => {
    for (const role of ["member", "viewer", "stranger"]) {
      await expect(db.as(users[role]!.claims, (c) => save(c, ws, null, { title: "No" })), role).rejects.toThrow(/cannot change issues/);
    }
    await expect(db.as(users.editor!.claims, (c) => save(c, other, null, { title: "Elsewhere" }))).rejects.toThrow(/cannot change issues/);
    const id = northbeamIssues()[0]!.id;
    await expect(db.as(users.viewer!.claims, (c) => save(c, ws, id, { title: "Hijack" }))).rejects.toThrow(/cannot change issues/);
    await expect(db.as(users.member!.claims, (c) => save(c, ws, id, {}, [], [], []))).rejects.toThrow(/cannot change issues/);
  });

  it("checks the target lengths and statuses in the database", async () => {
    await db.as(users.editor!.claims, async (c) => {
      await fails(c, () => save(c, ws, null, { title: "t", target_goal: "x".repeat(201) }), /issues_target_lengths/);
      await fails(c, () => save(c, ws, null, { title: "t", status: "done" }), /issues_status/);
    });
  });
});

describe("dismissed insights", () => {
  const rev1 = randomUUID();
  const rev2 = randomUUID();
  const key = `wait:step:${audit}`;
  beforeAll(async () => {
    for (const [id, n] of [[rev1, 91], [rev2, 92]] as const) {
      await db.client.query("insert into process_revisions (id, workspace_id, process_id, number, status) values ($1, $2, $3, $4, 'superseded')", [id, ws, NORTHBEAM_PROCESS_ID, n]);
    }
  });
  const dismiss = (c: Client, revision: string) =>
    save(c, ws, null, { title: "Wait at Audit", type: "delay", source: "promoted", detected_key: key, status: "dismissed", dismissed_revision_id: revision }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }]);

  it("is stored against the live revision, with no number, no history and no number used up", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const next = (await save(c, ws, null, { title: "A real one" })).number;
      const row = await dismiss(c, rev1);
      expect(row).toMatchObject({ status: "dismissed", number: null, dismissed_revision_id: rev1 });
      expect(await events(c, row.id)).toEqual([]);
      expect((await save(c, ws, null, { title: "The next real one" })).number).toBe(Number(next) + 1);
    });
  });

  it("can be dismissed again against a newer revision without a history entry", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const row = await dismiss(c, rev1);
      const again = await save(c, ws, row.id, { status: "dismissed", dismissed_revision_id: rev2 });
      expect(again).toMatchObject({ status: "dismissed", number: null, dismissed_revision_id: rev2 });
      expect(await events(c, row.id)).toEqual([]);
    });
  });

  it("becomes an issue when acknowledged: it gets the next number, a created event, and forgets the revision", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const row = await dismiss(c, rev1);
      const before = (await save(c, ws, null, { title: "Marker" })).number as number;
      const issue = await save(c, ws, row.id, { status: "open", title: "Wait at Audit, acknowledged" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], []);
      expect(issue).toMatchObject({ status: "open", number: before + 1, dismissed_revision_id: null });
      expect(await kinds(c, row.id)).toEqual(["created"]);
      expect((await events(c, row.id))[0]!.detail).toMatchObject({ acknowledged: true });
    });
  });

  it("keeps the revision only while the row is dismissed", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const row = await save(c, ws, null, { title: "Open with a stray revision", dismissed_revision_id: rev1 });
      expect(row.dismissed_revision_id).toBeNull();
    });
  });
});

describe("stable numbers", () => {
  it("count up per workspace, are never reused and can't be changed", async () => {
    const mk = (workspace: string, title: string) =>
      db.client.query("insert into issues (workspace_id, type, title) values ($1, 'idea', $2) returning id, number", [workspace, title]).then((r) => r.rows[0] as { id: string; number: number });
    const a = await mk(other, "one");
    const b = await mk(other, "two");
    expect([a.number, b.number]).toEqual([1, 2]);
    await db.client.query("delete from issues where id = $1", [b.id]);
    expect((await mk(other, "three")).number).toBe(3);
    await expect(db.client.query("update issues set number = 9 where id = $1", [a.id])).rejects.toThrow(/number cannot be changed/);
    // A supplied number is ignored.
    expect((await db.client.query("insert into issues (workspace_id, type, title, number) values ($1, 'idea', 'x', 77) returning number", [other])).rows[0].number).toBe(4);
  });

  it("are unique per workspace and don't collide when two writers insert at once", async () => {
    const make = async () => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      return c;
    };
    const [c1, c2] = await Promise.all([make(), make()]);
    try {
      // Each connection inserts six in turn, the two at the same time.
      const run = async (c: pg.Client) => {
        const got: number[] = [];
        for (let i = 0; i < 6; i++) got.push((await c.query("insert into issues (workspace_id, type, title) values ($1, 'idea', 'race') returning number", [other])).rows[0].number);
        return got;
      };
      const nums = (await Promise.all([run(c1), run(c2)])).flat();
      expect(new Set(nums).size).toBe(12);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    await expect(db.client.query("insert into issues (workspace_id, type, title) values ($1, 'idea', 'x') returning number", [ws]).then((r) => r.rows[0].number)).resolves.toBeGreaterThan(0);
  });
});

describe("history", () => {
  it("logs creation with the date and who", async () => {
    await db.as(users.owner!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Logged" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], []);
      const [e, ...rest] = await events(c, r.id);
      expect(rest).toEqual([]);
      expect(e).toMatchObject({ kind: "created", actor: users.owner!.id });
      expect(Math.abs(Date.now() - new Date(e.at).getTime())).toBeLessThan(60_000);
    });
  });

  it("logs every kind of change: edits, testing, resolving, reopening, won't fix", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Journey" });
      await save(c, ws, r.id, { title: "Journey, renamed", severity: "critical" });
      await save(c, ws, r.id, { status: "testing" });
      await save(c, ws, r.id, { status: "resolved" });
      await save(c, ws, r.id, { status: "open" });
      await save(c, ws, r.id, { status: "wont_fix" });
      await save(c, ws, r.id, { status: "testing" });
      const log = await events(c, r.id);
      expect(log.map((e) => e.kind)).toEqual(["created", "edited", "solution_tested", "resolved", "reopened", "resolved", "reopened"]);
      expect(log[1]!.detail).toEqual({ fields: ["severity", "title"] });
      expect(log[2]!.detail).toEqual({ from: "open", to: "testing" });
      expect(log[5]!.detail).toEqual({ from: "open", to: "wont_fix" });
      expect(log.every((e) => e.actor === users.editor!.id)).toBe(true);
    });
  });

  it("logs changes made by a direct update and by save_fields too, and ignores ones that change nothing", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Other routes" });
      await c.query("update issues set evidence = 'Seen on the call' where id = $1", [r.id]);
      await c.query("update issues set evidence = 'Seen on the call' where id = $1", [r.id]);
      const saved = (await c.query("select public.save_fields('issues', $1, $2, $3) as r", [JSON.stringify({ id: r.id }), JSON.stringify({ status: "open" }), JSON.stringify({ status: "testing" })])).rows[0].r;
      expect(saved.status).toBe("saved");
      expect(await kinds(c, r.id)).toEqual(["created", "edited", "solution_tested"]);
    });
  });

  it("logs a change to links, owners or sources once, and not again inside a save that already logged", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Links" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }]);
      expect(await kinds(c, r.id)).toEqual(["created"]);
      await c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [r.id, rosa, ws]);
      await c.query("insert into issue_sources (issue_id, source_id, workspace_id) values ($1, $2, $3)", [r.id, northbeamSourceIds.salesNotes, ws]);
      expect(await kinds(c, r.id)).toEqual(["created"]);
    });
    // In a later transaction each change logs once.
    const id = northbeamIssues()[2]!.id;
    const before = (await db.client.query("select count(*)::int as n from issue_events where issue_id = $1", [id])).rows[0].n;
    await db.client.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [id, rosa, ws]);
    await db.client.query("delete from issue_owners where issue_id = $1 and person_id = $2", [id, rosa]);
    const log = (await db.client.query("select kind, detail from issue_events where issue_id = $1 order by seq", [id])).rows.slice(before);
    // Both ran in autocommit, so each is its own transaction and its own event.
    expect(log).toEqual([
      { kind: "edited", detail: { linked: "owners" } },
      { kind: "edited", detail: { linked: "owners" } },
    ]);
  });

  it("does not log an unchanged save, and deleting an issue takes its history with it", async () => {
    await db.as(users.editor!.claims, async (c) => {
      const r = await save(c, ws, null, { title: "Same" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], []);
      const n = (await events(c, r.id)).length;
      await save(c, ws, r.id, { title: "Same" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], []);
      expect((await events(c, r.id)).length).toBe(n);
      await c.query("delete from issues where id = $1", [r.id]);
      expect((await c.query("select count(*)::int as n from issue_events where issue_id = $1", [r.id])).rows[0].n).toBe(0);
    });
  });

  it("is written only by the database: nobody can insert, edit or delete an entry through the API", async () => {
    const id = northbeamIssues()[0]!.id;
    for (const role of ["admin", "owner", "editor"]) {
      await expect(db.as(users[role]!.claims, (c) => c.query("insert into issue_events (issue_id, workspace_id, kind) values ($1, $2, 'created')", [id, ws])), role).rejects.toThrow(/permission denied|row-level security/);
      await expect(db.as(users[role]!.claims, (c) => c.query("update issue_events set kind = 'edited' where issue_id = $1", [id])), role).rejects.toThrow(/permission denied/);
      await expect(db.as(users[role]!.claims, (c) => c.query("delete from issue_events where issue_id = $1", [id])), role).rejects.toThrow(/permission denied/);
    }
  });
});

describe("row-level security on the new tables", () => {
  const first = northbeamIssues()[0]!.id;
  const tables = ["issue_links", "issue_owners", "issue_sources", "issue_events"] as const;
  const count = (c: Client, t: string, workspace: string) => c.query(`select count(*)::int as n from ${t} where workspace_id = $1`, [workspace]).then((r) => r.rows[0].n as number);

  it("is on for every new table, with no access for anon", async () => {
    const rls = (await db.client.query("select relname, relrowsecurity from pg_class where relname = any ($1)", [[...tables]])).rows;
    expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true, true, true]);
    for (const t of tables) {
      expect((await db.client.query("select has_table_privilege('anon', $1, 'select') as ok", [`public.${t}`])).rows[0].ok, t).toBe(false);
    }
  });

  it("lets every member of the workspace read, and nobody else", async () => {
    for (const role of ["admin", "owner", "editor", "member", "viewer"]) {
      for (const t of tables) expect(await db.as(users[role]!.claims, (c) => count(c, t, ws)), `${role} ${t}`).toBeGreaterThan(0);
    }
    for (const t of tables) {
      expect(await db.as(users.stranger!.claims, (c) => c.query(`select count(*)::int as n from ${t}`).then((r) => r.rows[0].n)), t).toBe(0);
    }
    expect(await db.as(users.editor!.claims, (c) => count(c, "issue_events", other))).toBe(0);
  });

  it("lets editors, owners and agency admins change links, owners and sources; members and viewers can't", async () => {
    for (const role of ["admin", "owner", "editor"]) {
      await db.as(users[role]!.claims, async (c) => {
        await c.query("insert into issue_links (issue_id, workspace_id, process_id, step_id) values ($1, $2, $3, $4)", [first, ws, NORTHBEAM_PROCESS_ID, northbeamStepIds.qualify]);
        await c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [first, priya, ws]);
        await c.query("insert into issue_sources (issue_id, source_id, workspace_id) values ($1, $2, $3)", [first, northbeamSourceIds.salesNotes, ws]);
        expect((await c.query("delete from issue_links where issue_id = $1 and step_id = $2", [first, northbeamStepIds.qualify])).rowCount, role).toBe(1);
      });
    }
    for (const role of ["member", "viewer", "stranger"]) {
      await expect(db.as(users[role]!.claims, (c) => c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [first, priya, ws])), role).rejects.toThrow(/row-level security|permission denied/);
      await expect(db.as(users[role]!.claims, (c) => c.query("insert into issue_links (issue_id, workspace_id, process_id) values ($1, $2, $3)", [first, ws, NORTHBEAM_PROCESS_ID])), role).rejects.toThrow(/row-level security|permission denied/);
      await expect(db.as(users[role]!.claims, (c) => c.query("insert into issue_sources (issue_id, source_id, workspace_id) values ($1, $2, $3)", [first, northbeamSourceIds.salesNotes, ws])), role).rejects.toThrow(/row-level security|permission denied/);
      const gone = await db.as(users[role]!.claims, async (c) => ({
        links: (await c.query("delete from issue_links where workspace_id = $1", [ws])).rowCount,
        owners: (await c.query("delete from issue_owners where workspace_id = $1", [ws])).rowCount,
        sources: (await c.query("delete from issue_sources where workspace_id = $1", [ws])).rowCount,
      }));
      expect(gone, role).toEqual({ links: 0, owners: 0, sources: 0 });
    }
  });

  it("keeps a workspace's issues to its own people, sources and processes, and an editor out of another workspace", async () => {
    await expect(db.as(users.editor!.claims, (c) => c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [first, randomUUID(), ws]))).rejects.toThrow(/foreign key/);
    await expect(db.as(users.editor!.claims, (c) => c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [first, rosa, other]))).rejects.toThrow(/row-level security|foreign key/);
    await expect(db.as(users.editor!.claims, (c) => c.query("insert into issue_sources (issue_id, source_id, workspace_id) values ($1, $2, $3)", [first, randomUUID(), ws]))).rejects.toThrow(/foreign key/);
  });

  it("leaves a detected issue's links to the engine", async () => {
    const id = (await db.client.query("insert into issues (workspace_id, type, title, source, detected_key) values ($1, 'delay', 'Stored detection', 'detected', $2) returning id", [ws, `wait:step:${audit}`])).rows[0].id;
    try {
      await expect(db.as(users.admin!.claims, (c) => c.query("insert into issue_owners (issue_id, person_id, workspace_id) values ($1, $2, $3)", [id, rosa, ws]))).rejects.toThrow(/row-level security/);
    } finally {
      await db.client.query("delete from issues where id = $1", [id]);
    }
  });

  it("deletes links, owners, sources and history with the issue", async () => {
    const r = await db.as(users.editor!.claims, async (c) => {
      const row = await save(c, ws, null, { title: "Gone" }, [{ process_id: NORTHBEAM_PROCESS_ID, step_id: audit }], [rosa], [northbeamSourceIds.salesNotes]);
      await c.query("delete from issues where id = $1", [row.id]);
      const counts: number[] = [];
      for (const t of tables) counts.push((await c.query(`select count(*)::int as n from ${t} where issue_id = $1`, [row.id])).rows[0].n);
      return counts;
    });
    expect(r).toEqual([0, 0, 0, 0]);
  });
});
