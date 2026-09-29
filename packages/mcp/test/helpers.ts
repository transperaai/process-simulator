import { createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcpRequest, type McpHandlerOptions } from "../src";

export const ENDPOINT = "https://flow.test/api/mcp";

/** An HS256 JWT, for PostgREST in tests. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** Call the endpoint the way Claude Code does: MCP client, Streamable HTTP, bearer token. */
export async function connect(token: string, options: McpHandlerOptions): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (url, init) => handleMcpRequest(new Request(url, init), options),
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/** The `{ok, data, assumptions}` payload of a tool call. */
export async function call<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; data: T; assumptions: string[]; error?: { code: string; message: string } }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text);
}

/** A raw JSON-RPC POST to the endpoint. */
export function post(options: McpHandlerOptions, headers: Record<string, string>, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) {
  return handleMcpRequest(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
    options,
  );
}
