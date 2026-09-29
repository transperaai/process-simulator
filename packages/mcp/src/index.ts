// MCP server (docs/PRD.md §7.1). The HTTP endpoint lives in the web app
// (apps/web/src/app/api/mcp/route.ts) and delegates to handleMcpRequest.
export { API_TOKEN_HEADER, handleMcpRequest, type McpHandlerOptions } from "./handler";
export { assertPublishableKey } from "./key-guard";
export { ToolError, type ToolPayload } from "./result";
export { generateApiToken, hashApiToken, looksLikeApiToken } from "./tokens";
export { createMcpServer, DEFAULT_REPS, DEFAULT_SEED, summarizeRun, TOOL_NAMES } from "./tools";
