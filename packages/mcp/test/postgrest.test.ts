import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_WORKSPACE_ID, northbeamBundle, northbeamScenarios, toEngineModel } from "@transpera-flow/db";
import { applyPatches, simulate } from "@transpera-flow/engine";
import { generateApiToken, TOOL_NAMES, type McpHandlerOptions } from "../src";
import { call, connect, post, signJwt } from "./helpers";

// End to end, as in production: MCP client → handleMcpRequest → supabase-js →
// PostgREST (with the pre-request hook) → Postgres with every migration, RLS
// and the seed. CI prepares the database with test/postgrest-db.ts, then
// starts PostgREST against it (.github/workflows/ci.yml); locally this suite
// is skipped unless POSTGREST_URL is set.

const POSTGREST_URL = process.env.POSTGREST_URL;
const JWT_SECRET = process.env.POSTGREST_JWT_SECRET ?? "";
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = "transpera_flow_postgrest";
const SUPABASE_URL = "https://project.supabase.test";

if (process.env.CI && !POSTGREST_URL) throw new Error("CI must run the PostgREST end-to-end suite: set POSTGREST_URL");

let admin: pg.Client;
let options: McpHandlerOptions;
const anonKey = () => signJwt({ role: "anon", iss: "test" }, JWT_SECRET);

/** Route supabase-js's `<url>/rest/v1/...` requests to PostgREST, which serves at its root. */
const toPostgrest: typeof fetch = (input, init) => {
  if (input instanceof Request) throw new Error("expected supabase-js to pass a URL string");
  return fetch(String(input).replace(`${SUPABASE_URL}/rest/v1`, POSTGREST_URL!), init);
};

async function rest(path: string, headers: Record<string, string>) {
  return fetch(`${POSTGREST_URL}${path}`, { headers: { authorization: `Bearer ${anonKey()}`, ...headers } });
}

async function createUser(email: string, appMetadata: Record<string, unknown> = {}) {
  const id = randomUUID();
  await admin.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [id, email, appMetadata]);
  return id;
}

async function issueToken(userId: string) {
  const { token, hash } = generateApiToken();
  await admin.query("insert into api_tokens (user_id, token_hash, label) values ($1, $2, 'e2e')", [userId, hash]);
  return token;
}

let memberToken: string;
let strangerToken: string;
let memberId: string;
let otherWorkspaceId: string;

describe.skipIf(!POSTGREST_URL)("MCP over PostgREST (acts as the user under RLS)", () => {
  beforeAll(async () => {
    // postgrest-db.ts prepared this database before PostgREST started.
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE_NAME}`;
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();

    memberId = await createUser("member@example.com");
    const strangerId = await createUser("stranger@example.com");
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')", [NORTHBEAM_WORKSPACE_ID, memberId]);
    otherWorkspaceId = (await admin.query("insert into workspaces (name, slug) values ('Other Co', 'other-co') returning id")).rows[0].id;
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [otherWorkspaceId, strangerId]);
    memberToken = await issueToken(memberId);
    strangerToken = await issueToken(strangerId);

    options = { supabaseUrl: SUPABASE_URL, supabaseKey: anonKey(), fetch: toPostgrest };

    // Wait for PostgREST to connect, load the schema and the hook.
    const deadline = Date.now() + 60_000;
    let last = "";
    for (;;) {
      try {
        const res = await rest("/workspaces?select=id", { "x-api-token": memberToken });
        last = `${res.status} ${await res.text()}`;
        if (res.status === 200 && JSON.parse(last.slice(4)).length === 1) break;
      } catch (err) {
        last = String(err);
      }
      if (Date.now() > deadline) throw new Error(`PostgREST never became ready: ${last}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  it("lists the five tools to an MCP client", async () => {
    const client = await connect(memberToken, options);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  it("shows a member their workspace and its process", async () => {
    const client = await connect(memberToken, options);
    const list = await call<{ id: string; slug: string }[]>(client, "list_workspaces");
    expect(list).toMatchObject({ ok: true, assumptions: [] });
    expect(list.data.map((w) => w.id)).toEqual([NORTHBEAM_WORKSPACE_ID]);

    const summary = await call<{ processes: { id: string; live_revision: number }[] }>(client, "get_workspace_summary");
    expect(summary.ok).toBe(true);
    expect(summary.data.processes.map((p) => p.id)).toEqual([NORTHBEAM_PROCESS_ID]);
    expect(summary.assumptions.join(" ")).toMatch(/only workspace/);

    const process = await call<{ steps: unknown[]; edges: unknown[] }>(client, "get_process", { process: NORTHBEAM_PROCESS_ID });
    expect(process.ok).toBe(true);
    expect(process.data.steps).toHaveLength(12);
    expect(process.data.edges).toHaveLength(14);
    await client.close();
  });

  it("hides the workspace from a token whose user has no membership", async () => {
    const client = await connect(strangerToken, options);
    const list = await call<{ id: string }[]>(client, "list_workspaces");
    expect(list.data.map((w) => w.id)).toEqual([otherWorkspaceId]);

    for (const [tool, args] of [
      ["set_active_workspace", { workspace: NORTHBEAM_WORKSPACE_ID }],
      ["get_workspace_summary", { workspace: "northbeam" }],
      ["get_process", { workspace: NORTHBEAM_WORKSPACE_ID, process: NORTHBEAM_PROCESS_ID }],
      ["run_scenario", { workspace: "Northbeam" }],
    ] as const) {
      const r = await call(client, tool, args);
      expect(r, tool).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    await client.close();

    // Straight at the Data API with the same token: RLS still hides every row.
    for (const table of ["workspaces", "processes", "steps", "edges", "people"]) {
      const column = table === "workspaces" ? "id" : "workspace_id";
      const res = await rest(`/${table}?select=${column}&${column}=eq.${NORTHBEAM_WORKSPACE_ID}`, { "x-api-token": strangerToken });
      expect(res.status, table).toBe(200);
      expect(await res.json(), table).toEqual([]);
    }
  });

  it("remembers the active workspace per token", async () => {
    const client = await connect(memberToken, options);
    expect(await call(client, "set_active_workspace", { workspace: "northbeam" })).toMatchObject({ ok: true });
    await client.close();
    const again = await connect(memberToken, options);
    const list = await call<{ id: string; active: boolean }[]>(again, "list_workspaces");
    expect(list.data).toEqual([expect.objectContaining({ id: NORTHBEAM_WORKSPACE_ID, active: true })]);
    const summary = await call(again, "get_workspace_summary");
    expect(summary.assumptions.join(" ")).not.toMatch(/only workspace/);
    await again.close();
  });

  it("run_scenario returns the browser's numbers for the same model and seed", async () => {
    const startDate = "2026-10-05";
    const client = await connect(memberToken, options);
    const run = await call<{ kpi: unknown; reps: number; seed: number; trace?: unknown }>(client, "run_scenario", {
      start_date: startDate,
    });
    await client.close();
    expect(run.ok).toBe(true);
    expect(run.assumptions).toEqual(expect.arrayContaining(["reps defaulted to 30.", "seed defaulted to 1."]));
    expect(run.data).not.toHaveProperty("trace");
    // The browser: toEngineModel(bundle) in ProcessView, then simulate(model, 30, 1) in the worker.
    const browser = simulate(toEngineModel(northbeamBundle(), { startDate }), 30, 1);
    expect(run.data.kpi).toEqual(JSON.parse(JSON.stringify(browser.kpi)));
    expect(run.data).toMatchObject({ reps: 30, seed: 1 });
  });

  it("run_scenario applies overrides as the browser applies a scenario, and refuses ones it can't apply", async () => {
    const startDate = "2026-10-05";
    const overrides = northbeamScenarios().find((s) => s.name === "Automate proposals")!.patch;
    const client = await connect(memberToken, options);
    const run = await call<{ kpi: unknown; overrides: unknown }>(client, "run_scenario", { start_date: startDate, overrides });
    const bad = await call(client, "run_scenario", {
      start_date: startDate,
      overrides: [{ path: "steps.gone.work_hours", op: "set", value: 1 }],
    });
    await client.close();
    const browser = simulate(applyPatches(toEngineModel(northbeamBundle(), { startDate }), overrides).model, 30, 1);
    expect(run.ok).toBe(true);
    expect(run.data.kpi).toEqual(JSON.parse(JSON.stringify(browser.kpi)));
    expect(run.data.overrides).toEqual(overrides);
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid_overrides" } });
  });

  it("runs of the live model ignore an open draft (issue #9)", async () => {
    const startDate = "2026-10-05";
    const opened = (await admin.query("select public.open_draft($1) as r", [NORTHBEAM_PROCESS_ID])).rows[0].r;
    try {
      await admin.query("update steps set work_hours = 30 where revision_id = $1", [opened.revision_id]);
      const client = await connect(memberToken, options);
      const live = await call<{ kpi: unknown; revision: { status: string } }>(client, "run_scenario", { start_date: startDate, reps: 5 });
      const draft = await call<{ kpi: unknown; revision: { status: string } }>(client, "run_scenario", {
        start_date: startDate,
        reps: 5,
        revision: "draft",
      });
      const process = await call<{ steps: { work_hours: number }[] }>(client, "get_process", { process: NORTHBEAM_PROCESS_ID });
      await client.close();
      const browser = simulate(toEngineModel(northbeamBundle(), { startDate }), 5, 1);
      expect(live.data.revision.status).toBe("published");
      expect(live.data.kpi).toEqual(JSON.parse(JSON.stringify(browser.kpi)));
      expect(draft.data.revision.status).toBe("draft");
      expect(draft.data.kpi).not.toEqual(live.data.kpi);
      expect(process.data.steps.some((s) => Number(s.work_hours) === 30)).toBe(false);
    } finally {
      await admin.query("select public.discard_draft($1)", [NORTHBEAM_PROCESS_ID]);
    }
  });

  it("serves the draft RPCs to a signed-in editor, as the web app calls them (issue #9)", async () => {
    const editorId = await createUser("draft-editor@example.com");
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'editor')", [NORTHBEAM_WORKSPACE_ID, editorId]);
    const session = signJwt({ sub: editorId, role: "authenticated", aud: "authenticated", app_metadata: {} }, JWT_SECRET);
    const rpc = async (fn: string, body: object) => {
      const res = await fetch(`${POSTGREST_URL}/rpc/${fn}`, {
        method: "POST",
        headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status, fn).toBe(200);
      return res.json();
    };
    const opened = await rpc("open_draft", { target_process: NORTHBEAM_PROCESS_ID });
    expect(opened).toMatchObject({ status: "ok", created: true });
    expect(await rpc("publish_process", { target_process: NORTHBEAM_PROCESS_ID, accept_estimates: false })).toMatchObject({
      status: "published",
      number: opened.number,
    });
    const audit = await admin.query("select actor_id, diff from audit_log where action = 'publish' and target_id = $1", [NORTHBEAM_PROCESS_ID]);
    expect(audit.rows).toEqual([expect.objectContaining({ actor_id: editorId })]);
    expect(await rpc("discard_draft", { target_process: NORTHBEAM_PROCESS_ID })).toEqual({ status: "no_draft" });
  });

  it("rejects revoked and unknown tokens with 401", async () => {
    const token = await issueToken(memberId);
    await admin.query("update api_tokens set revoked_at = now() where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [token]);
    expect((await post(options, { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await post(options, { authorization: `Bearer ${generateApiToken().token}` })).status).toBe(401);
    // use_api_token's own check, without the header (so without the hook).
    const direct = await fetch(`${POSTGREST_URL}/rpc/use_api_token`, {
      method: "POST",
      headers: { authorization: `Bearer ${anonKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(direct.status).toBe(401);
  });

  it("rate-limits per token", async () => {
    const limited = await issueToken(memberId);
    const other = await issueToken(memberId);
    await admin.query(
      "update api_tokens set rate_window_start = now(), rate_window_count = 120 where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [limited],
    );
    const res = await post(options, { authorization: `Bearer ${limited}` });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(options, { authorization: `Bearer ${other}` })).status).toBe(200);
  });

  it("leaves signed-in and anonymous Data API requests as they were", async () => {
    const session = signJwt({ sub: memberId, role: "authenticated", aud: "authenticated", app_metadata: {} }, JWT_SECRET);
    const signedIn = await fetch(`${POSTGREST_URL}/workspaces?select=id`, { headers: { authorization: `Bearer ${session}` } });
    expect(await signedIn.json()).toEqual([{ id: NORTHBEAM_WORKSPACE_ID }]);

    const anon = await rest("/workspaces?select=id", {});
    expect(anon.status).not.toBe(200);

    const both = await fetch(`${POSTGREST_URL}/workspaces?select=id`, {
      headers: { authorization: `Bearer ${session}`, "x-api-token": strangerToken },
    });
    expect(both.status).toBe(400);
  });
});
