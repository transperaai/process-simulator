import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiToken, type McpHandlerOptions } from "../src";
import { call, connect, signJwt } from "./helpers";

// End to end for the process-building tools (issue #24), as in production:
// MCP client → handleMcpRequest → supabase-js → PostgREST with the
// pre-request hook → Postgres with every migration and RLS. Runs against the
// database postgrest-db.ts prepares (see postgrest.test.ts), in a workspace
// of its own so it can run beside that suite. Skipped unless POSTGREST_URL is set.

const POSTGREST_URL = process.env.POSTGREST_URL;
const JWT_SECRET = process.env.POSTGREST_JWT_SECRET ?? "";
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = process.env.POSTGREST_DATABASE ?? "transpera_flow_postgrest";
const SUPABASE_URL = "https://project.supabase.test";

let admin: pg.Client;
let options: McpHandlerOptions;
let workspaceId: string;
let editorId: string;
let editorToken: string;
let viewerToken: string;
let strangerToken: string;
let consultantRoleId: string;

const toPostgrest: typeof fetch = (input, init) => {
  if (input instanceof Request) throw new Error("expected supabase-js to pass a URL string");
  return fetch(String(input).replace(`${SUPABASE_URL}/rest/v1`, POSTGREST_URL!), init);
};

async function createUser(email: string) {
  const id = randomUUID();
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

async function issueToken(userId: string) {
  const { token, hash } = generateApiToken();
  await admin.query("insert into api_tokens (user_id, token_hash, label) values ($1, $2, 'e2e')", [userId, hash]);
  return token;
}

type Row = Record<string, unknown>;

/** A revision's steps and edges as stored, for "live is unchanged" checks. */
async function snapshot(revisionId: string) {
  const steps = (await admin.query("select * from steps where revision_id = $1 order by id", [revisionId])).rows as Row[];
  const edges = (await admin.query("select * from edges where revision_id = $1 order by id", [revisionId])).rows as Row[];
  return { steps, edges };
}

async function processRow(name: string) {
  return (await admin.query("select * from processes where workspace_id = $1 and name = $2", [workspaceId, name])).rows[0] as Row & {
    id: string;
    live_revision_id: string | null;
    draft_revision_id: string | null;
    source: string;
  };
}

async function stepsOf(revisionId: string) {
  return (await admin.query("select * from steps where revision_id = $1", [revisionId])).rows as (Row & {
    id: string;
    name: string;
    provenance: Record<string, Row>;
  })[];
}

describe.skipIf(!POSTGREST_URL)("MCP process building over PostgREST (drafts only, as the user)", () => {
  beforeAll(async () => {
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE_NAME}`;
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();

    workspaceId = (await admin.query("insert into workspaces (name, slug) values ('Build Co', 'build-co') returning id")).rows[0].id;
    consultantRoleId = (await admin.query("insert into roles (workspace_id, name) values ($1, 'Consultant') returning id", [workspaceId])).rows[0].id;
    await admin.query("insert into roles (workspace_id, name) values ($1, 'Account manager')", [workspaceId]);
    editorId = await createUser("builder-editor@example.com");
    const viewerId = await createUser("builder-viewer@example.com");
    const strangerId = await createUser("builder-stranger@example.com");
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')", [workspaceId, editorId, viewerId]);
    const otherId = (await admin.query("insert into workspaces (name, slug) values ('Elsewhere', 'elsewhere') returning id")).rows[0].id;
    await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [otherId, strangerId]);
    editorToken = await issueToken(editorId);
    viewerToken = await issueToken(viewerId);
    strangerToken = await issueToken(strangerId);

    options = { supabaseUrl: SUPABASE_URL, supabaseKey: signJwt({ role: "anon", iss: "test" }, JWT_SECRET), fetch: toPostgrest };

    const deadline = Date.now() + 60_000;
    for (;;) {
      const res = await fetch(`${POSTGREST_URL}/workspaces?select=id`, {
        headers: { authorization: `Bearer ${options.supabaseKey}`, "x-api-token": editorToken },
      }).catch(() => null);
      if (res?.status === 200 && ((await res.json()) as unknown[]).length === 1) break;
      if (Date.now() > deadline) throw new Error("PostgREST never became ready");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  let sourceA: string;
  let sourceB: string;

  it("builds a new process from transcripts into a draft, and publishes only when estimates are settled or accepted", async () => {
    const editor = await connect(editorToken, options);
    const a = await call<{ source: { id: string } }>(editor, "add_source", {
      title: "Discovery interview",
      speakers: "Ana Ruiz, Ben Cole",
      recorded_at: "2026-10-01",
      body: "[00:02:10] Ana Ruiz: A discovery call is an hour and a half with notes...",
    });
    expect(a.ok).toBe(true);
    expect(a.assumptions).toContain("kind defaulted to transcript.");
    sourceA = a.data.source.id;
    const b = await call<{ source: { id: string } }>(editor, "add_source", { title: "Ops notes", kind: "notes", speakers: ["Ben Cole"] });
    sourceB = b.data.source.id;

    const r = await call<{
      created: boolean;
      process: { id: string };
      matched: { name: string; id: string; by: string }[];
      diff: { steps: { added: { name: string }[] }; text: string };
      conflicts: { field: string; step: string }[];
      checklist: { kind: string; step: { name: string }; field: string }[];
      text: string;
    }>(editor, "import_process", {
      process_json: {
        name: "Sales pipeline",
        kind: "pipeline",
        entity_name: "lead",
        steps: [
          { name: "Enquiry", kind: "start" },
          {
            name: "Discovery",
            role: "consultant",
            work_hours: 1.5,
            wait_hours: 24,
            rework_rate: 0,
            evidence: [{ field: "work_hours", source: sourceA, speaker: "Ana Ruiz", quote: "an hour and a half with notes", timestamp: "00:02:10", value: 1.5 }],
            assumptions: [{ field: "wait_hours", reasoning: "Calls are usually booked the next day." }],
          },
          {
            name: "Proposal",
            role: "Consultant",
            evidence: [
              { field: "work_hours", source: "Discovery interview", speaker: "Ana Ruiz", quote: "four hours for a proposal", value: 4 },
              { field: "work_hours", source: sourceB, speaker: "Ben Cole", quote: "proposals take a day", value: 8 },
            ],
          },
          { name: "Client decision", kind: "decision" },
          { name: "Won", kind: "end", outcome: "won" },
          { name: "Lost", kind: "end", outcome: "lost" },
        ],
        edges: [
          { from: "Enquiry", to: "Discovery" },
          { from: "Discovery", to: "Proposal" },
          { from: "Proposal", to: "Client decision" },
          { from: "Client decision", to: "Won", probability: 0.4 },
          { from: "Client decision", to: "Lost" },
        ],
      },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.data.created).toBe(true);
    expect(r.data.diff.steps.added).toHaveLength(6);
    expect(r.data.diff.text).toMatch(/^New process: 6 steps added/);
    expect(r.data.conflicts).toEqual([expect.objectContaining({ step: "Proposal", field: "work_hours" })]);
    // Conflicts first, then assumptions, as the canvas's checklist rail lists them.
    expect(r.data.checklist[0]).toMatchObject({ kind: "conflict", step: { name: "Proposal" }, field: "work_hours" });
    expect(r.data.checklist.filter((i) => i.kind === "assumption").map((i) => `${i.step.name}.${i.field}`)).toEqual(
      expect.arrayContaining(["Discovery.wait_hours", "Proposal.wait_hours", "Proposal.rework_rate", "Discovery.rework_rate"]),
    );
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        "Step 'Proposal': wait_hours defaulted to 0 h (estimated; confirm it on the canvas).",
        "'Client decision': one branch's probability defaulted to 60% (the share the others leave).",
      ]),
    );

    const proc = await processRow("Sales pipeline");
    expect(proc).toMatchObject({ source: "import", live_revision_id: null });
    const steps = await stepsOf(proc.draft_revision_id!);
    const discovery = steps.find((s) => s.name === "Discovery")!;
    expect(discovery).toMatchObject({ role_id: consultantRoleId, created_by: editorId, assumption: true });
    expect(discovery.provenance.work_hours).toMatchObject({
      source: "estimated",
      by: editorId,
      evidence: [{ source_id: sourceA, speaker: "Ana Ruiz", quote: "an hour and a half with notes", timestamp: "00:02:10", value: 1.5 }],
    });
    expect(discovery.provenance.wait_hours).toMatchObject({ assumption: true, note: "Calls are usually booked the next day." });
    const proposal = steps.find((s) => s.name === "Proposal")!;
    expect(proposal).toMatchObject({ conflict: true, work_dist: "triangular", work_params: { min: 4, mode: 6, max: 8 } });
    // 8 h vs 4 h is 2× apart: the database logs a perception gap.
    const gap = await admin.query("select title, source from issues where workspace_id = $1 and type = 'perception_gap'", [workspaceId]);
    expect(gap.rows).toEqual([{ title: "Sources disagree on Proposal: hands-on time", source: "promoted" }]);

    // Publishing is refused while estimates are open, listing them; nothing goes live.
    const refused = await call(editor, "publish_process", { process: "Sales pipeline" });
    expect(refused).toMatchObject({ ok: false, error: { code: "unresolved" } });
    expect((refused.error as unknown as { candidates: { kind: string }[] }).candidates[0]).toMatchObject({ kind: "conflict" });
    expect((await processRow("Sales pipeline")).live_revision_id).toBeNull();

    const published = await call<{ revision: { number: number }; accepted_estimates: boolean; text: string }>(editor, "publish_process", {
      process: "sales",
      accept_estimates: true,
    });
    expect(published).toMatchObject({ ok: true, data: { revision: { number: 1 }, accepted_estimates: true } });
    expect(published.data.text).toMatch(/^Published 'Sales pipeline' as revision 1 \(6 steps added, 0 removed, 0 changed\), accepting \d+ steps with estimates\./);
    const audit = await admin.query("select actor_id, actor_kind, diff from audit_log where action = 'publish' and target_id = $1", [proc.id]);
    expect(audit.rows).toEqual([expect.objectContaining({ actor_id: editorId, actor_kind: "mcp", diff: expect.objectContaining({ accept_estimates: true }) })]);
    await editor.close();
  });

  it("import_process with a target writes into the draft, keeps stable ids, returns the diff, and never overwrites an entered value", async () => {
    const proc = await processRow("Sales pipeline");
    const liveId = proc.live_revision_id!;
    // Someone confirmed Discovery's hands-on time on the canvas before this was published (entered).
    await admin.query(
      `update steps set work_hours = 2, provenance = jsonb_set(provenance, '{work_hours}', '{"source":"entered","at":"2026-10-02T09:00:00Z"}')
       where revision_id = $1 and name = 'Discovery'`,
      [liveId],
    );
    const liveBefore = await snapshot(liveId);
    const liveIds = liveBefore.steps.map((s) => s.id);

    const editor = await connect(editorToken, options);
    const r = await call<{
      created: boolean;
      draft: { revision_id: string; opened_now: boolean };
      matched: { name: string; id: string; by: string }[];
      diff: {
        steps: { added: { name: string }[]; removed: unknown[]; changed: { name: string; fields: Record<string, unknown> }[] };
        edges: { added: { from: string; to: string }[]; removed: { from: string; to: string }[] };
        text: string;
      };
      not_overwritten: { step: string; field: string; kept: number; proposed: number }[];
      conflicts: { step: string; field: string; values: { value: number; speaker: string | null }[] }[];
    }>(editor, "import_process", {
      target: "Sales pipeline",
      process_json: {
        name: "Renamed pipeline",
        steps: [
          { name: "discovery", work_hours: 3, evidence: [{ field: "work_hours", source: sourceB, speaker: "Ben Cole", quote: "discovery is more like three hours", value: 3 }] },
          { name: "Negotiation", role: "Consultant", work_hours: 2, evidence: [{ field: "work_hours", source: sourceB, speaker: "Ben Cole", quote: "two hours of back and forth", value: 2 }] },
        ],
        edges: [
          { from: "Client decision", to: "Negotiation", probability: 0.45 },
          { from: "Client decision", to: "Lost", probability: 0.55 },
          { from: "Negotiation", to: "Won" },
        ],
      },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.assumptions).toEqual(expect.arrayContaining(["process_json's name was ignored: they belong to the process, not its draft."]));
    expect(r.data).toMatchObject({ created: false, draft: { opened_now: true } });
    const discoveryId = liveBefore.steps.find((s) => s.name === "Discovery")!.id;
    expect(r.data.matched).toEqual([
      { name: "discovery", id: discoveryId, by: "name" },
      { name: "Negotiation", id: expect.any(String), by: "new" },
    ]);
    // Entered 2 h is kept; Ben's 3 h is flagged as a conflict with its source.
    expect(r.data.not_overwritten).toEqual([expect.objectContaining({ step: "Discovery", field: "work_hours", kept: 2, proposed: 3 })]);
    expect(r.data.conflicts).toEqual([
      expect.objectContaining({ step: "Discovery", field: "work_hours", values: [expect.objectContaining({ value: 2, speaker: null }), expect.objectContaining({ value: 3, speaker: "Ben Cole" })] }),
    ]);
    expect(r.data.diff.steps.added.map((s) => s.name)).toEqual(["Negotiation"]);
    expect(r.data.diff.steps.removed).toEqual([]);
    expect(r.data.diff.steps.changed).toEqual([
      expect.objectContaining({ name: "Discovery", fields: expect.objectContaining({ conflict: { live: false, draft: true } }) }),
    ]);
    expect(r.data.diff.steps.changed[0]!.fields).not.toHaveProperty("work_hours");
    expect(r.data.diff.edges.added).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "Client decision", to: "Negotiation" }), expect.objectContaining({ from: "Negotiation", to: "Won" })]),
    );
    expect(r.data.diff.edges.removed).toEqual([expect.objectContaining({ from: "Client decision", to: "Won" })]);

    // Stable ids: every live step is in the draft under the same id; live is untouched.
    const draftSteps = await stepsOf(r.data.draft.revision_id);
    expect(draftSteps.map((s) => s.id)).toEqual(expect.arrayContaining(liveIds));
    expect(draftSteps.find((s) => s.id === discoveryId)).toMatchObject({ work_hours: "2", conflict: true });
    expect(await snapshot(liveId)).toEqual(liveBefore);
    expect((await processRow("Sales pipeline")).name).toBe("Sales pipeline");

    // A second import of the same interview is idempotent: nothing new to write.
    const again = await call<{ diff: { steps: { added: unknown[] } }; not_overwritten: unknown[] }>(editor, "import_process", {
      target: proc.id,
      process_json: { steps: [{ name: "Negotiation", work_hours: 2 }], edges: [] },
    });
    expect(again.ok).toBe(true);
    expect(again.data.not_overwritten).toEqual([]);
    expect((await stepsOf(r.data.draft.revision_id)).length).toBe(draftSteps.length);
    await editor.close();
  });

  it("step tools write only into the draft, resolve names, and return candidates for an ambiguous one", async () => {
    const proc = await processRow("Sales pipeline");
    const liveBefore = await snapshot(proc.live_revision_id!);
    const editor = await connect(editorToken, options);

    const added = await call<{ step: { id: string; assumption: boolean }; edges: { id: string; from: { name: string }; to: { name: string } }[]; text: string }>(
      editor,
      "add_step",
      { process: "Sales pipeline", name: "Contract review", after: "Negotiation", work_hours: 1 },
    );
    expect(added.ok, JSON.stringify(added)).toBe(true);
    expect(added.data.step.assumption).toBe(true);
    expect(added.data.edges.map((e) => `${e.from.name}→${e.to.name}`).sort()).toEqual(["Contract review→Won", "Negotiation→Contract review"]);
    expect(added.assumptions).toEqual(
      expect.arrayContaining([
        "Step 'Contract review': work_hours 1 h has no cited source; marked as an assumption.",
        "Step 'Contract review': wait_hours defaulted to 0 h (estimated; confirm it on the canvas).",
      ]),
    );
    expect(added.data.text).toMatch(/^Added 'Contract review' to the draft of 'Sales pipeline' after 'Negotiation'\. 3 values are assumptions to confirm\./);

    expect(await call(editor, "add_step", { process: "Sales pipeline", name: "Proposal review", before: "Client decision" })).toMatchObject({ ok: true });
    const ambiguous = await call(editor, "update_step", { process: "Sales pipeline", step: "review", work_hours: 5 });
    expect(ambiguous).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect((ambiguous.error as unknown as { candidates: { name: string }[] }).candidates.map((c) => c.name).sort()).toEqual(["Contract review", "Proposal review"]);

    const updated = await call<{ changes: Record<string, unknown>; step: { work_hours: number; tool: string } }>(editor, "update_step", {
      step: "contract rev",
      work_hours: 1.5,
      tool: "DocuSign",
      assumptions: [{ field: "work_hours", reasoning: "Legal reads it once." }],
    });
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    expect(updated.data.step).toMatchObject({ work_hours: 1.5, tool: "DocuSign" });

    // Branches must add up: set_routing refuses otherwise, and keeps ids of branches that stay.
    expect(await call(editor, "set_routing", { step: "Contract review", routes: [{ to: "Won", probability: 0.9 }, { to: "Lost", probability: 0.2 }] })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    const routed = await call<{ routes: { id: string; to: { name: string }; probability: number }[] }>(editor, "set_routing", {
      step: "Contract review",
      routes: [
        { to: "Won", probability: 0.9 },
        { to: "Lost", probability: 0.1 },
      ],
    });
    expect(routed.ok, JSON.stringify(routed)).toBe(true);
    expect(routed.data.routes.find((x) => x.to.name === "Won")!.id).toBe(added.data.edges.find((x) => x.to.name === "Won")!.id);
    expect(await call(editor, "connect_steps", { from: "Won", to: "Lost" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await call(editor, "connect_steps", { from: "Contract review", to: "Won" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    const removed = await call<{ rerouted_edges: { from: { name: string }; to: { name: string } }[] }>(editor, "remove_step", {
      step: "Proposal review",
      reconnect: true,
    });
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    expect(removed.data.rerouted_edges.map((e) => `${e.from.name}→${e.to.name}`)).toEqual(["Proposal→Client decision"]);

    // Split-style removal keeps a retired row under the same id.
    await call(editor, "add_step", { name: "Legal check", after: "Contract review", before: "Won", work_hours: 0.5 });
    const legal = (await stepsOf(proc.draft_revision_id!)).find((s) => s.name === "Legal check")!;
    const retired = await call(editor, "remove_step", { step: legal.id, replaced_by: ["Contract review"] });
    expect(retired.ok, JSON.stringify(retired)).toBe(true);
    const row = (await stepsOf(proc.draft_revision_id!)).find((s) => s.id === legal.id)!;
    expect(row.replaced_by).toHaveLength(1);

    // The draft never reached live.
    expect(await snapshot(proc.live_revision_id!)).toEqual(liveBefore);
    const draft = await call<{ steps: { name: string }[] }>(editor, "get_process", { process: "Sales pipeline", revision: "draft" });
    expect(draft.data.steps.map((s) => s.name)).toContain("Contract review");
    expect(draft.data.steps.map((s) => s.name)).not.toContain("Legal check");
    await editor.close();
  });

  it("viewers can't build and strangers can't see the workspace", async () => {
    const proc = await processRow("Sales pipeline");
    const before = await snapshot(proc.draft_revision_id!);
    const viewer = await connect(viewerToken, options);
    for (const [tool, args] of [
      ["add_source", { title: "Mine" }],
      ["create_process", { name: "Viewer's" }],
      ["add_step", { process: "Sales pipeline", name: "Sneaky" }],
      ["update_step", { process: "Sales pipeline", step: "Discovery", work_hours: 9 }],
      ["remove_step", { process: "Sales pipeline", step: "Discovery" }],
      ["connect_steps", { process: "Sales pipeline", from: "Discovery", to: "Lost" }],
      ["set_routing", { process: "Sales pipeline", step: "Discovery", routes: [{ to: "Lost", probability: 1 }] }],
      ["import_process", { target: "Sales pipeline", process_json: { steps: [{ name: "Sneaky" }] } }],
      ["publish_process", { process: "Sales pipeline", accept_estimates: true }],
      ["discard_draft", { process: "Sales pipeline" }],
      ["create_from_template", { template: "client onboarding" }],
    ] as const) {
      expect(await call(viewer, tool, args), tool).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    await viewer.close();
    expect(await snapshot(proc.draft_revision_id!)).toEqual(before);

    const stranger = await connect(strangerToken, options);
    for (const [tool, args] of [
      ["add_step", { workspace: "build-co", process: "Sales pipeline", name: "x" }],
      ["import_process", { workspace: workspaceId, process_json: { name: "x", steps: [] } }],
      ["publish_process", { workspace: "Build Co" }],
    ] as const) {
      expect(await call(stranger, tool, args), tool).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    await stranger.close();
  });

  it("creates from a template into a draft, and discards it", async () => {
    const editor = await connect(editorToken, options);
    const list = await call<{ templates: { id: string; name: string }[] }>(editor, "list_templates");
    expect(list.data.templates.map((t) => t.id)).toEqual(["agency-sales-pipeline", "client-onboarding", "monthly-reporting"]);
    const made = await call<{ checklist: unknown[]; steps: { kind: string; assumption: boolean }[] }>(editor, "create_from_template", {
      template: "onboarding",
      name: "Onboarding",
    });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(made.data.steps.filter((s) => s.kind === "task").every((s) => s.assumption)).toBe(true);
    expect(made.data.checklist.length).toBeGreaterThan(0);
    expect(await processRow("Onboarding")).toMatchObject({ source: "template", live_revision_id: null });
    expect(await call(editor, "create_from_template", { template: "onboarding", name: "onboarding" })).toMatchObject({ ok: false, error: { code: "name_taken" } });
    const discarded = await call<{ text: string }>(editor, "discard_draft", { process: "Onboarding" });
    expect(discarded).toMatchObject({ ok: true });
    expect(await processRow("Onboarding")).toMatchObject({ draft_revision_id: null });
    expect(await call(editor, "publish_process", { process: "Onboarding" })).toMatchObject({ ok: false, error: { code: "no_draft" } });

    const created = await call<{ steps: { name: string }[] }>(editor, "create_process", { name: "Reporting", kind: "servicing" });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    expect(created.data.steps.map((s) => s.name).sort()).toEqual(["Done", "Start"]);
    await editor.close();
  });

  it("audit-logs every MCP write with actor_kind mcp", async () => {
    const rows = (
      await admin.query("select actor_id, actor_kind, action, target_table from audit_log where workspace_id = $1 order by created_at", [workspaceId])
    ).rows as { actor_id: string; actor_kind: string; action: string; target_table: string }[];
    const mcp = rows.filter((r) => r.actor_kind === "mcp");
    expect(mcp.length).toBeGreaterThan(0);
    expect(mcp.every((r) => r.actor_id === editorId)).toBe(true);
    const seen = new Set(mcp.map((r) => `${r.action} ${r.target_table}`));
    for (const kind of [
      "insert sources",
      "insert processes",
      "open_draft processes",
      "insert steps",
      "update steps",
      "delete steps",
      "insert edges",
      "update edges",
      "delete edges",
      "publish processes",
      "discard_draft processes",
    ]) {
      expect(seen, kind).toContain(kind);
    }
    // Only the test's own setup (as the database owner) is logged as anything else.
    expect(rows.filter((r) => r.actor_kind !== "mcp").every((r) => r.target_table === "memberships")).toBe(true);
  });
});
