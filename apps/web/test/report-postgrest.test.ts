import { createHmac, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NORTHBEAM_PROCESS_ID, NORTHBEAM_WORKSPACE_ID, type Database } from "@transpera-flow/db";
import { generateApiToken, handleMcpRequest, type McpHandlerOptions } from "@transpera-flow/mcp";
import type { ReportContent } from "@/lib/report/content";
import { reportDownload } from "@/lib/report/download";
import { reportExporter } from "@/lib/report/exporter";

// MCP export_report end to end, as in production (issue #28): MCP client →
// handleMcpRequest → the report pipeline → supabase-js → PostgREST (with the
// pre-request hook, so everything runs as the token's user under RLS) →
// Postgres with every migration. Covers what only the Data API can show:
// the run and report inserts, the robustness cache upsert, the PDF as bytea
// hex both ways, and the signed link through `report_download` for anyone.
// CI prepares the database (packages/mcp/test/postgrest-db.ts) and starts
// PostgREST; locally this suite is skipped unless POSTGREST_URL is set. The
// PDF printer is a stub here (report-pdf.test.ts prints a real one).

const POSTGREST_URL = process.env.POSTGREST_URL;
const JWT_SECRET = process.env.POSTGREST_JWT_SECRET ?? "";
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = process.env.POSTGREST_DATABASE ?? "transpera_flow_postgrest";
const SUPABASE_URL = "https://project.supabase.test";
const ORIGIN = "https://flow.test";

if (process.env.CI && !POSTGREST_URL) throw new Error("CI must run the PostgREST end-to-end suite: set POSTGREST_URL");

function signJwt(claims: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const toPostgrest: typeof fetch = (input, init) => {
  if (input instanceof Request) throw new Error("expected supabase-js to pass a URL string");
  return fetch(String(input).replace(`${SUPABASE_URL}/rest/v1`, POSTGREST_URL!), init);
};

/** A stand-in for Chromium: a tiny valid-looking PDF that says which report it is. */
const FAKE_PDF = new TextEncoder().encode("%PDF-1.7\n% report\n%%EOF\n");
const renderPdf = async () => FAKE_PDF;

let admin: pg.Client;
let options: McpHandlerOptions;
let editorToken: string;
let viewerToken: string;
const anonKey = () => signJwt({ role: "anon", iss: "test" }, JWT_SECRET);

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (url, init) => handleMcpRequest(new Request(url, init), options),
  });
  const client = new Client({ name: "report-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; data: T; error?: { code: string; message: string } }> {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}

type Export = { id: string; url: string; run_id: string; pdf: boolean; included: string[]; summary: string[]; expires_at: string };

describe.skipIf(!POSTGREST_URL)("export_report over PostgREST", () => {
  beforeAll(async () => {
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE_NAME}`;
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    const user = async (role: string) => {
      const id = randomUUID();
      await admin.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{}')", [id, `${role}-${id.slice(0, 8)}@report.example.com`]);
      await admin.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [NORTHBEAM_WORKSPACE_ID, id, role]);
      const { token, hash } = generateApiToken();
      await admin.query("insert into api_tokens (user_id, token_hash, label) values ($1, $2, 'report e2e')", [id, hash]);
      return token;
    };
    editorToken = await user("editor");
    viewerToken = await user("viewer");
    options = { supabaseUrl: SUPABASE_URL, supabaseKey: anonKey(), fetch: toPostgrest, reports: reportExporter(ORIGIN, { renderPdf }) };
  });

  afterAll(async () => {
    await admin?.end();
  });

  it("generates a report as the token's user, stores it with its run, and returns a signed URL", async () => {
    const client = await connect(editorToken);
    const res = await call<Export>(client, "export_report", { scenarios: ["Hire a strategist"], reps: 10 });
    await client.close();
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const out = res.data;
    expect(out.pdf).toBe(true);
    expect(out.url).toMatch(new RegExp(`^${ORIGIN}/api/reports/${out.id}/pdf\\?token=[A-Za-z0-9_-]{43}$`));
    expect(out.included).toContain("robustness");
    expect(Date.parse(out.expires_at)).toBeGreaterThan(Date.now());

    const report = (await admin.query("select run_id, process_id, pdf, content from reports where id = $1", [out.id])).rows[0];
    expect(report.run_id).toBe(out.run_id);
    expect(report.process_id).toBe(NORTHBEAM_PROCESS_ID);
    expect(Buffer.compare(report.pdf, Buffer.from(FAKE_PDF))).toBe(0);
    const run = (await admin.query("select reps, seed, engine_version, results from runs where id = $1", [out.run_id])).rows[0];
    expect(run).toMatchObject({ reps: 10, seed: 1 });
    expect(run.engine_version).toBeTruthy();
    // The report's figures are the saved run's.
    expect(report.content.kpis.find((k: { key: string }) => k.key === "won").stat).toEqual(run.results.won);
    const cached = (await admin.query("select count(*)::int as n from robustness_results where run_id = $1", [out.run_id])).rows[0].n;
    expect(cached).toBeGreaterThan(0);

    // Anyone holding the link gets the PDF and the content; nobody without it.
    const anon = createClient<Database>(SUPABASE_URL, anonKey(), { auth: { persistSession: false }, global: { fetch: toPostgrest } });
    const token = new URL(out.url).searchParams.get("token")!;
    const pdf = await reportDownload(anon, out.id, { token, json: false });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(FAKE_PDF);
    const json = await reportDownload(anon, out.id, { token, json: true });
    expect(((await json.json()) as ReportContent).run.id).toBe(out.run_id);
    expect((await reportDownload(anon, out.id, { token: "x".repeat(43), json: false })).status).toBe(404);
    expect((await reportDownload(anon, randomUUID(), { token, json: false })).status).toBe(404);
    // Without a token, anon can't read reports at all.
    await expect(reportDownload(anon, out.id, { token: null, json: false })).rejects.toMatchObject({ code: "42501" });
  }, 180_000);

  it("reuses the cached robustness checks on the next report of the same model", async () => {
    const client = await connect(editorToken);
    const res = await call<Export>(client, "export_report", { scenarios: ["Hire a strategist"], reps: 10, format: "json", sections: ["scenarios", "robustness"] });
    await client.close();
    expect(res.ok).toBe(true);
    expect(res.data.pdf).toBe(false);
    expect(res.data.url).toMatch(/&format=json$/);
    const content = (await admin.query("select content from reports where id = $1", [res.data.id])).rows[0].content as ReportContent;
    const r = content.scenarios![0]!.robustness!;
    expect(r.cached).toBe(r.jobs);
  }, 180_000);

  it("stores the report and points at the printable one when Chromium can't print", async () => {
    const failing = reportExporter(ORIGIN, {
      renderPdf: async () => {
        throw new Error('Chromium couldn\'t start: The input directory "/var/task/bin" does not exist.');
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved = options;
    options = { ...options, reports: failing };
    try {
      const client = await connect(editorToken);
      const res = await call<Export & { pdf_error: string; print_url: string; pdf_fallback: string }>(client, "export_report", { reps: 5, sections: ["summary"] });
      await client.close();
      expect(res.ok).toBe(true);
      expect(res.data.pdf).toBe(false);
      expect(res.data.pdf_error).toContain("does not exist");
      expect(res.data.print_url).toBe(`${ORIGIN}/w/northbeam/reports/${res.data.id}/print`);
      expect(res.data.pdf_fallback).toContain(res.data.print_url);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(res.data.id), expect.any(Error));
      const stored = (await admin.query("select pdf, content is not null as has_content from reports where id = $1", [res.data.id])).rows[0];
      expect(stored).toMatchObject({ pdf: null, has_content: true });
    } finally {
      options = saved;
      log.mockRestore();
    }
  }, 180_000);

  it("refuses viewers: reports hold per-person utilisation", async () => {
    const client = await connect(viewerToken);
    const res = await call<Export>(client, "export_report", {});
    await client.close();
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("forbidden");
  });
});
