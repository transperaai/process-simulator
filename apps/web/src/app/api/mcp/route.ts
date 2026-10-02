import { handleMcpRequest } from "@transpera-flow/mcp";
import { afterPublish } from "@/lib/ai/trigger";
import { supabaseEnv } from "@/lib/supabase/env";

// MCP endpoint (docs/PRD.md §7.1, §10). Authenticated by a personal API token
// (Authorization: Bearer tf_…) and run as that user under RLS; see
// docs/adr/0002-mcp-acts-as-user-via-pre-request.md. Uses only the
// publishable key.

// Server-side simulation can take a few seconds, and the robustness checks run
// for up to 120 s.
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const env = supabaseEnv();
  if (!env) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  // A version published through MCP is reviewed by AI too, after the response (if the workspace has that switched on).
  return handleMcpRequest(request, { supabaseUrl: env.url, supabaseKey: env.key, onPublished: afterPublish });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
