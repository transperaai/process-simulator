import { handleMcpRequest } from "@transpera-flow/mcp";
import { anthropicNarrator } from "@/lib/narration/anthropic";
import { reportExporter } from "@/lib/report/exporter";
import { supabaseEnv } from "@/lib/supabase/env";

// MCP endpoint (docs/PRD.md §7.1, §10). Authenticated by a personal API token
// (Authorization: Bearer tf_…) and run as that user under RLS; see
// docs/adr/0002-mcp-acts-as-user-via-pre-request.md. Uses only the
// publishable key.

// Server-side simulation can take a few seconds; export_report (issue #28)
// runs robustness checks (capped at 120 s together), narration when asked
// (#29, capped at 75 s; Claude is injected here, server-side) and headless
// Chromium.
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const env = supabaseEnv();
  if (!env) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  return handleMcpRequest(request, { supabaseUrl: env.url, supabaseKey: env.key, reports: reportExporter(new URL(request.url).origin, { narrator: () => anthropicNarrator() }) });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
