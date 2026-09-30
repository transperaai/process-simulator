import type { NextRequest } from "next/server";
import { reportDownload } from "@/lib/report/download";
import { isUuid } from "@/lib/report/options";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// A stored report's PDF, or its content with `format=json` (issue #28). With
// `token` it is the signed link (the proxy lets it through without a
// session); without one, the signed-in user's own download under RLS.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/reports/[id]/pdf">): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  if (!supabaseEnv()) return new Response("Supabase is not configured", { status: 503 });
  return reportDownload(await createClient(), id, {
    token: request.nextUrl.searchParams.get("token"),
    json: request.nextUrl.searchParams.get("format") === "json",
  });
}
