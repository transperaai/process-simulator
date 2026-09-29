import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPublishableKey, generateApiToken, hashApiToken, looksLikeApiToken, TOOL_NAMES, type McpHandlerOptions } from "../src";
import { ENDPOINT, connect, post, signJwt } from "./helpers";

// The endpoint without a database: a stub stands in for PostgREST's
// use_api_token RPC. Data access is covered end to end in postgrest.test.ts.

const SUPABASE_URL = "https://project.supabase.test";

function stub(result: Record<string, unknown> | { status: number; body: unknown }): McpHandlerOptions & { seen: Request[] } {
  const seen: Request[] = [];
  return {
    supabaseUrl: SUPABASE_URL,
    supabaseKey: "sb_publishable_test",
    seen,
    fetch: async (input, init) => {
      const req = new Request(input, init);
      seen.push(req);
      if (req.url === `${SUPABASE_URL}/rest/v1/rpc/use_api_token`) {
        if ("status" in result) return Response.json(result.body, { status: result.status as number });
        return Response.json(result);
      }
      return Response.json({ message: `unexpected ${req.method} ${req.url}` }, { status: 500 });
    },
  };
}

const ok = { allowed: true, retry_after_seconds: 30, active_workspace_id: null, acting_as_user: true };

describe("API tokens", () => {
  it("are tf_ + 32 random bytes, and hash to lowercase hex SHA-256", () => {
    const { token, hash } = generateApiToken();
    expect(looksLikeApiToken(token)).toBe(true);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateApiToken().token).not.toBe(token);
  });
});

describe("handleMcpRequest", () => {
  it("lists the five tools to an MCP client with a valid token", async () => {
    const options = stub(ok);
    const { token } = generateApiToken();
    const client = await connect(token, options);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
    // Every Supabase request carried the token for the pre-request hook, and only the publishable key.
    expect(options.seen.length).toBeGreaterThan(0);
    for (const r of options.seen) {
      expect(r.headers.get("x-api-token")).toBe(token);
      expect(r.headers.get("apikey")).toBe("sb_publishable_test");
    }
  });

  it("asks for a bearer token", async () => {
    const res = await post(stub(ok), {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("rejects malformed tokens without calling the database", async () => {
    const options = stub(ok);
    expect((await post(options, { authorization: "Bearer nope" })).status).toBe(401);
    expect(options.seen).toHaveLength(0);
  });

  it("returns 401 when the database rejects the token", async () => {
    const options = stub({ status: 401, body: { code: "API_TOKEN", message: "Invalid or revoked API token", details: null, hint: null } });
    const res = await post(options, { authorization: `Bearer ${generateApiToken().token}` });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/Invalid or revoked/);
  });

  it("rate-limits per token with 429 and Retry-After", async () => {
    const res = await post(stub({ ...ok, allowed: false, retry_after_seconds: 17 }), { authorization: `Bearer ${generateApiToken().token}` });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
  });

  it("refuses to serve if the pre-request hook did not switch to the user", async () => {
    const res = await post(stub({ ...ok, acting_as_user: false }), { authorization: `Bearer ${generateApiToken().token}` });
    expect(res.status).toBe(503);
  });

  it("only accepts POST (stateless server)", async () => {
    const { handleMcpRequest } = await import("../src");
    const res = await handleMcpRequest(new Request(ENDPOINT, { method: "GET" }), stub(ok));
    expect(res.status).toBe(405);
  });
});

describe("never the service-role key (D12)", () => {
  it("refuses secret and elevated keys at runtime", () => {
    expect(() => assertPublishableKey("sb_secret_abc")).toThrow();
    expect(() => assertPublishableKey(signJwt({ role: "service_role" }, "x"))).toThrow();
    expect(() => assertPublishableKey(signJwt({ role: "anon" }, "x"))).not.toThrow();
    expect(() => assertPublishableKey("sb_publishable_abc")).not.toThrow();
  });

  it("has no reference to a service-role or secret key anywhere in the MCP code path", () => {
    const roots = [new URL("../src/", import.meta.url), new URL("../../../apps/web/src/app/api/mcp/", import.meta.url)];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    for (const root of roots) walk(root.pathname.replace(/\/$/, ""));
    expect(files.some((f) => f.endsWith("api/mcp/route.ts"))).toBe(true);
    const offenders = files.filter((f) => /service_?role|SECRET_KEY|SERVICE_KEY/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
