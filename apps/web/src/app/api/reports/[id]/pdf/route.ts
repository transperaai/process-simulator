import type { NextRequest } from "next/server";
import { fromByteaHex } from "@/lib/report/server";
import { isUuid } from "@/lib/report/options";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// A stored report's PDF (or, with `format=json`, its content; issue #28,
// docs/PRD.md §7.1 `export_report`). With `token` it is the signed link: no
// sign-in, until the link expires (`public.report_download`). Without one it
// is the signed-in user's own download, under RLS.

const filename = (title: string, ext: string) => `${title.replace(/[^\w\s.-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "report"}.${ext}`;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/reports/[id]/pdf">): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  if (!supabaseEnv()) return new Response("Supabase is not configured", { status: 503 });
  const token = request.nextUrl.searchParams.get("token");
  const json = request.nextUrl.searchParams.get("format") === "json";
  const supabase = await createClient();

  let title: string;
  let pdfHex: unknown;
  let content: unknown;
  if (token) {
    const { data, error } = await supabase.rpc("report_download", { token });
    if (error) throw error;
    const row = data?.[0];
    if (!row || row.id !== id) return new Response("This link has expired or isn't valid. Ask for a new one.", { status: 404 });
    ({ title, pdf: pdfHex, content } = row);
  } else {
    const { data, error } = await supabase.from("reports").select(json ? "title, content" : "title, pdf").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return new Response("Not found", { status: 404 });
    title = data.title;
    pdfHex = "pdf" in data ? data.pdf : null;
    content = "content" in data ? data.content : null;
  }

  const headers = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };
  if (json) {
    return new Response(JSON.stringify(content, null, 2), {
      headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename(title, "json")}"` },
    });
  }
  const pdf = fromByteaHex(pdfHex);
  if (!pdf) return new Response("This report has no PDF. Open the printable report and use your browser's Save as PDF.", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { ...headers, "content-type": "application/pdf", "content-disposition": `inline; filename="${filename(title, "pdf")}"` },
  });
}
