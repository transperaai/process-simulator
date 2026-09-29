import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@transpera-flow/db";
import { assertPublishableKey } from "./key-guard";
import { hashApiToken, looksLikeApiToken } from "./tokens";
import { createMcpServer } from "./tools";

// The /api/mcp endpoint (docs/PRD.md §7.1, §10; docs/adr/0001-*). Stateless
// Streamable HTTP: every POST builds a fresh server whose Supabase client
// sends the caller's API token in `x-api-token`. A PostgREST pre-request hook
// turns that into the token owner's identity, so every query runs as the user
// under RLS. Only the publishable key is ever used here.

export interface McpHandlerOptions {
  supabaseUrl: string;
  /** The publishable (anon) key. Secret and service-role keys are refused. */
  supabaseKey: string;
  /** For tests: the fetch Supabase requests go through. */
  fetch?: typeof fetch;
  /** For tests: the current date. */
  now?: () => Date;
}

/** The request header the pre-request hook reads (private.api_token_pre_request). */
export const API_TOKEN_HEADER = "x-api-token";

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const unauthorized = (message: string) =>
  jsonRpcError(401, message, { "www-authenticate": 'Bearer realm="transpera-flow", error="invalid_token"' });

interface TokenUse {
  allowed: boolean;
  retry_after_seconds: number;
  active_workspace_id: string | null;
  acting_as_user: boolean;
}

export async function handleMcpRequest(request: Request, options: McpHandlerOptions): Promise<Response> {
  if (request.method !== "POST") {
    // Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE).
    return jsonRpcError(405, "Method not allowed", { allow: "POST" });
  }
  assertPublishableKey(options.supabaseKey);

  const auth = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) return unauthorized("Missing bearer token. Create an API token in Transpera Flow under Settings → API tokens.");
  if (!looksLikeApiToken(token)) return unauthorized("Malformed API token");

  const db = createClient<Database>(options.supabaseUrl, options.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { [API_TOKEN_HEADER]: token }, ...(options.fetch ? { fetch: options.fetch } : {}) },
  });

  const { data, error } = await db.rpc("use_api_token", { token });
  if (error) {
    if (error.code === "API_TOKEN" || /api token/i.test(error.message)) return unauthorized(error.message);
    throw new Error(`API token check failed: ${error.message}`);
  }
  const use = data as unknown as TokenUse;
  if (!use.acting_as_user) {
    // The pre-request hook is not installed, so queries would run as anon.
    return jsonRpcError(503, "API tokens are not enabled on this database (pre-request hook missing)");
  }
  if (!use.allowed) {
    return jsonRpcError(429, "Rate limit exceeded for this API token", { "retry-after": String(use.retry_after_seconds || 60) });
  }

  const server = createMcpServer({
    db,
    tokenHash: hashApiToken(token),
    activeWorkspaceId: use.active_workspace_id,
    today: (options.now?.() ?? new Date()).toISOString().slice(0, 10),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
