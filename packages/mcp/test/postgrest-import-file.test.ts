import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProcessFile, PROCESS_FILE_EXAMPLE, type Database, type ProcessFile } from "@transpera-flow/db";
import { importProcessFile, previewProcessFile, ToolError } from "../src";
import type { ToolContext } from "../src/context";
import { signJwt } from "./helpers";

// Upload a process (issue #166, B13), end to end as the web app does it: a checked transpera-process/1 file → the shared
// import code → PostgREST with RLS as the signed-in user → Postgres with every migration. Runs against the database
// postgrest-db.ts prepares (see postgrest.test.ts), in a workspace of its own. Skipped unless POSTGREST_URL is set.

const POSTGREST_URL = process.env.POSTGREST_URL;
const JWT_SECRET = process.env.POSTGREST_JWT_SECRET ?? "";
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = process.env.POSTGREST_DATABASE ?? "transpera_flow_postgrest";
const SUPABASE_URL = "https://project.supabase.test";

let admin: pg.Client;
let workspaceId: string;
let consultantId: string;
let managerId: string;
let editorCtx: ToolContext;
let viewerCtx: ToolContext;
let strangerCtx: ToolContext;
let editorId: string;
let otherWorkspaceRoleId: string;

const toPostgrest: typeof fetch = (input, init) => fetch(String(input).replace(`${SUPABASE_URL}/rest/v1`, POSTGREST_URL!), init);

async function createUser(email: string) {
  const id = randomUUID();
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

/** What the web app builds for a signed-in user: a client carrying their JWT, no API token. */
function contextFor(userId: string): ToolContext {
  const anon = signJwt({ role: "anon", iss: "test" }, JWT_SECRET);
  const user = signJwt({ sub: userId, role: "authenticated", iss: "test", aud: "authenticated" }, JWT_SECRET);
  const db = createClient<Database>(SUPABASE_URL, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${user}` }, fetch: toPostgrest },
  });
  return { db, tokenHash: "", userId, activeWorkspaceId: null, today: "2026-10-02" };
}

/** The example, with its roles renamed to roles the workspace has, as a checked file. */
// Typed loosely on purpose: the tests break a file in one way at a time, by reaching into it.
function example(change: (f: ReturnType<typeof JSON.parse>) => void = () => {}): ProcessFile {
  const f = JSON.parse(JSON.stringify(PROCESS_FILE_EXAMPLE));
  for (const s of f.steps) {
    if (s.role === "Managing director") s.role = "Consultant";
  }
  change(f);
  const checked = checkProcessFile(f);
  expect(checked.errors).toEqual([]);
  return checked.file!;
}

// Rows come back from pg as loosely typed objects.
const processRow = async (name: string) => (await admin.query("select * from processes where workspace_id = $1 and name = $2", [workspaceId, name])).rows[0];
const stepsOf = async (revisionId: string) => (await admin.query("select * from steps where revision_id = $1 order by name", [revisionId])).rows;
const edgesOf = async (revisionId: string) => (await admin.query("select * from edges where revision_id = $1", [revisionId])).rows;
const processCount = async () => (await admin.query("select count(*)::int as n from processes where workspace_id = $1", [workspaceId])).rows[0].n as number;

describe.skipIf(!POSTGREST_URL)("uploading a process file over PostgREST (a draft, as the user)", () => {
  beforeAll(async () => {
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE_NAME}`;
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();

    workspaceId = (await admin.query("insert into workspaces (name, slug) values ('Upload Co', 'upload-co') returning id")).rows[0].id;
    consultantId = (await admin.query("insert into roles (workspace_id, name) values ($1, 'Consultant') returning id", [workspaceId])).rows[0].id;
    managerId = (await admin.query("insert into roles (workspace_id, name) values ($1, 'Account manager') returning id", [workspaceId])).rows[0].id;
    await admin.query("insert into roles (workspace_id, name, active) values ($1, 'Retired role', false)", [workspaceId]);
    await admin.query("insert into people (workspace_id, name) values ($1, 'Sam Rivera')", [workspaceId]);
    editorId = await createUser("upload-editor@example.com");
    const viewerId = await createUser("upload-viewer@example.com");
    const strangerId = await createUser("upload-stranger@example.com");
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')", [workspaceId, editorId, viewerId]);
    const otherId = (await admin.query("insert into workspaces (name, slug) values ('Upload Elsewhere', 'upload-elsewhere') returning id")).rows[0].id;
    otherWorkspaceRoleId = (await admin.query("insert into roles (workspace_id, name) values ($1, 'Their role') returning id", [otherId])).rows[0].id;
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [otherId, strangerId]);
    editorCtx = contextFor(editorId);
    viewerCtx = contextFor(viewerId);
    strangerCtx = contextFor(strangerId);

    const deadline = Date.now() + 60_000;
    for (;;) {
      const r = await editorCtx.db.from("workspaces").select("id");
      if (!r.error && (r.data ?? []).length >= 1) break;
      if (Date.now() > deadline) throw new Error("PostgREST never became ready");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  it("creates a new process with a draft only, laid out left to right, roles matched, numbers marked to confirm, and logs the import", async () => {
    const r = await importProcessFile(editorCtx, example(), { workspaceId, source: "enquiry-to-client.json" });
    expect(r).toMatchObject({ process: { name: "Enquiry to signed client" }, steps: 8, links: 7 });
    expect(r.to_confirm).toBeGreaterThan(0);

    const proc = (await processRow("Enquiry to signed client"))!;
    expect(proc).toMatchObject({ source: "import", kind: "pipeline", live_revision_id: null, draft_revision_id: r.revision_id, description: "From a new enquiry to a signed engagement letter." });
    const steps = await stepsOf(r.revision_id);
    expect(steps.map((s) => s.name).sort()).toEqual(["Client declines", "Client decides", "Client signs", "Discovery call", "Enquiry arrives", "Not a fit", "Review enquiry", "Write proposal"].sort());
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));
    expect(byName["Enquiry arrives"].kind).toBe("start");
    expect(byName["Client decides"].kind).toBe("decision");
    expect([byName["Client signs"].outcome, byName["Client declines"].outcome, byName["Not a fit"].outcome].sort()).toEqual(["done", "lost", "won"]);
    expect(byName["Review enquiry"]).toMatchObject({ role_id: consultantId, notes: "Checked the same day if it comes in before noon." });
    expect(Number(byName["Review enquiry"].work_hours)).toBe(0.25);
    expect(Number(byName["Review enquiry"].wait_hours)).toBe(4);
    expect(Number(byName["Discovery call"].rework_rate)).toBe(0.1);
    expect(byName["Write proposal"].role_id).toBe(managerId);
    // A number the file gives is an assumption to confirm, saying where it came from; one it leaves out is a default, also to confirm.
    expect(byName["Review enquiry"].provenance.work_hours).toMatchObject({ source: "estimated", assumption: true });
    expect(byName["Review enquiry"].provenance.work_hours.note).toContain("Stated in the uploaded file 'enquiry-to-client.json'");
    expect(byName["Write proposal"].assumption).toBe(true);
    // No positions were given: laid out by distance from the start, left to right.
    expect(Number(byName["Enquiry arrives"].x)).toBeLessThan(Number(byName["Review enquiry"].x));
    expect(Number(byName["Review enquiry"].x)).toBeLessThan(Number(byName["Discovery call"].x));
    expect(Number(byName["Discovery call"].x)).toBeLessThan(Number(byName["Write proposal"].x));
    expect(new Set(steps.map((s) => `${s.x},${s.y}`)).size).toBe(8);

    const edges = await edgesOf(r.revision_id);
    expect(edges).toHaveLength(7);
    const review = edges.filter((e) => e.from_step_id === byName["Review enquiry"].id);
    expect(review.map((e) => [Number(e.probability), e.label]).sort()).toEqual([[0.33, "Not a fit"], [0.67, "Qualified"]]);

    expect((await admin.query("select count(*)::int as n from process_revisions where process_id = $1", [proc.id])).rows[0].n).toBe(1);
    const log = (await admin.query("select * from audit_log where target_table = 'processes' and target_id = $1 and action = 'import'", [proc.id])).rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: editorId, actor_kind: "user", diff: { source: "enquiry-to-client.json", text: "Imported from enquiry-to-client.json" } });
  });

  it("publishing the draft puts the process in the library like any other", async () => {
    const proc = (await processRow("Enquiry to signed client"))!;
    expect(proc.live_revision_id).toBeNull();
    const { data, error } = await editorCtx.db.rpc("publish_process", { target_process: proc.id, accept_estimates: true });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("published");
    const after = (await processRow("Enquiry to signed client"))!;
    expect(after.live_revision_id).not.toBeNull();
  });

  it("uses the positions a file gives, and puts the steps of a group inside it", async () => {
    const file = example((f) => {
      f.name = "With positions and a group";
      f.steps[1].x = 500;
      f.steps[1].y = 300;
      f.steps[2].x = 800;
      f.steps[2].y = 300;
      f.groups = [{ name: "Sales work", steps: ["call", "proposal"] }];
    });
    const r = await importProcessFile(editorCtx, file, { workspaceId, source: "grouped.json" });
    const steps = await stepsOf(r.revision_id);
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));
    expect(Number(byName["Review enquiry"].x)).toBe(500);
    expect(Number(byName["Review enquiry"].y)).toBe(300);
    expect(byName["Sales work"].kind).toBe("group");
    expect(byName["Discovery call"].parent_step_id).toBe(byName["Sales work"].id);
    expect(byName["Write proposal"].parent_step_id).toBe(byName["Sales work"].id);
    expect(byName["Review enquiry"].parent_step_id).toBeNull();
  });

  it("maps an unknown role to a role the company has, or leaves it blank, and never creates one", async () => {
    const withRole = (name: string) =>
      example((f) => {
        f.name = name;
        f.steps[1].role = "Sales lead";
        f.steps[2].role = "sales  lead";
        f.steps[3].role = "Retired role";
      });
    const before = (await admin.query("select count(*)::int as n from roles where workspace_id = $1", [workspaceId])).rows[0].n;

    const preview = await previewProcessFile(editorCtx, workspaceId, withRole("Preview only"));
    expect(preview.unknownRoles).toEqual(["Sales lead", "Retired role"]);
    expect(preview.matchedRoles).toEqual([]);
    expect(preview.roles.map((r) => r.name)).toEqual(["Account manager", "Consultant"]);
    expect(preview.canEdit).toBe(true);
    expect(preview.nameTaken).toBeNull();

    const mapped = await importProcessFile(editorCtx, withRole("Roles mapped"), { workspaceId, source: "roles.json", roleMap: { "Sales lead": managerId, "Retired role": null } });
    const mappedSteps = Object.fromEntries((await stepsOf(mapped.revision_id)).map((s) => [s.name, s]));
    expect(mappedSteps["Review enquiry"].role_id).toBe(managerId);
    expect(mappedSteps["Discovery call"].role_id).toBe(managerId);
    expect(mappedSteps["Write proposal"].role_id).toBe(null);
    expect(mapped.warnings).toContain("One step has no role: the file's role isn't one of your roles and wasn't mapped to one.");

    const blank = await importProcessFile(editorCtx, withRole("Roles blank"), { workspaceId, source: "roles.json" });
    const blankSteps = await stepsOf(blank.revision_id);
    expect(blankSteps.filter((s) => s.role_id !== null)).toEqual([]);
    expect(blank.warnings[0]).toMatch(/3 steps have no role/);

    expect((await admin.query("select count(*)::int as n from roles where workspace_id = $1", [workspaceId])).rows[0].n).toBe(before);
  });

  it("refuses a role mapped to another company's role, and creates nothing", async () => {
    const before = await processCount();
    const file = example((f) => {
      f.name = "Wrong role";
      f.steps[1].role = "Sales lead";
    });
    await expect(importProcessFile(editorCtx, file, { workspaceId, source: "x.json", roleMap: { "Sales lead": otherWorkspaceRoleId } })).rejects.toThrow(/isn't one of this company's/);
    expect(await processCount()).toBe(before);
  });

  it("pins a step to a person who is in the company and never creates one", async () => {
    const file = example((f) => {
      f.name = "With people";
      f.steps[1].person = "sam rivera";
      f.steps[2].person = "Nobody Known";
    });
    const peopleBefore = (await admin.query("select count(*)::int as n from people where workspace_id = $1", [workspaceId])).rows[0].n;
    const preview = await previewProcessFile(editorCtx, workspaceId, file);
    expect(preview.unknownPeople).toEqual(["Nobody Known"]);
    const r = await importProcessFile(editorCtx, file, { workspaceId, source: "people.json" });
    const steps = Object.fromEntries((await stepsOf(r.revision_id)).map((s) => [s.name, s]));
    expect(steps["Review enquiry"].person_id).not.toBeNull();
    expect(steps["Discovery call"].person_id).toBeNull();
    expect(r.warnings).toContain("'Nobody Known' isn't in your company, so that step was left unassigned.");
    expect((await admin.query("select count(*)::int as n from people where workspace_id = $1", [workspaceId])).rows[0].n).toBe(peopleBefore);
  });

  it("says plainly when a process with that name exists, and lets the upload be renamed", async () => {
    const before = await processCount();
    const preview = await previewProcessFile(editorCtx, workspaceId, example());
    expect(preview.nameTaken?.name).toBe("Enquiry to signed client");
    const err = await importProcessFile(editorCtx, example(), { workspaceId, source: "again.json" }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.message).toBe("You already have a process called 'Enquiry to signed client'. Give this one a different name.");
    expect(await processCount()).toBe(before);
    const renamed = await importProcessFile(editorCtx, example(), { workspaceId, source: "again.json", name: "Enquiry to signed client (copy)" });
    expect(renamed.process.name).toBe("Enquiry to signed client (copy)");
  });

  it("doesn't count the company map's name as taken (it isn't in the process list)", async () => {
    const company = (await admin.query("select name from processes where workspace_id = $1 and is_company", [workspaceId])).rows[0];
    expect(company).toBeDefined();
    const file = example((f) => {
      f.name = company.name;
    });
    expect((await previewProcessFile(editorCtx, workspaceId, file)).nameTaken).toBeNull();
    const r = await importProcessFile(editorCtx, file, { workspaceId, source: "company.json" });
    expect(r.process.name).toBe(company.name);
  });

  it("is for editors: a viewer and someone outside the workspace create nothing", async () => {
    const before = await processCount();
    const file = example((f) => {
      f.name = "Not allowed";
    });
    await expect(importProcessFile(viewerCtx, file, { workspaceId, source: "x.json" })).rejects.toThrow(/permission/);
    await expect(importProcessFile(strangerCtx, file, { workspaceId, source: "x.json" })).rejects.toThrow(/No workspace you can access/);
    expect(await processCount()).toBe(before);
    expect((await previewProcessFile(viewerCtx, workspaceId, file)).canEdit).toBe(false);
  });

  it("still makes the process when the change log can't be written, and says so", async () => {
    const ctx = contextFor(editorId);
    const rpc = ctx.db.rpc.bind(ctx.db);
    (ctx.db as unknown as { rpc: unknown }).rpc = (fn: string, args: never) =>
      fn === "log_process_import" ? Promise.resolve({ data: null, error: { message: "function does not exist" } }) : rpc(fn as never, args);
    const file = example((f) => {
      f.name = "No log";
    });
    const r = await importProcessFile(ctx, file, { workspaceId, source: "nolog.json" });
    expect(r.warnings).toContain("The process was made, but the activity log entry for the import couldn't be written.");
    expect(await processRow("No log")).toBeDefined();
  });
});
