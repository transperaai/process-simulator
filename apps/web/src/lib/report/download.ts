// Serving a stored report (issue #28; docs/PRD.md §7.1 `export_report`): the
// PDF or, with `json`, the content. With a token it is the signed link, open
// to whoever holds it until it expires (`public.report_download`); without
// one it is the caller's own download under RLS. The route handler passes
// the request's Supabase client; tests pass one talking to PostgREST.

import type { Db } from "@transpera-flow/db";
import { fromByteaHex } from "./server";

const filename = (title: string, ext: string) =>
  `${
    title
      .replace(/[^\w\s.-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "report"
  }.${ext}`;

export async function reportDownload(db: Db, id: string, { token, json }: { token: string | null; json: boolean }): Promise<Response> {
  let title: string;
  let pdfHex: unknown = null;
  let content: unknown = null;
  if (token) {
    const { data, error } = await db.rpc("report_download", { token });
    if (error) throw error;
    const row = data?.[0];
    if (!row || row.id !== id) return new Response("This link has expired or isn't valid. Ask for a new one.", { status: 404 });
    ({ title, pdf: pdfHex, content } = row);
  } else if (json) {
    const { data, error } = await db.from("reports").select("title, content").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return new Response("Not found", { status: 404 });
    ({ title, content } = data);
  } else {
    const { data, error } = await db.from("reports").select("title, pdf").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return new Response("Not found", { status: 404 });
    ({ title, pdf: pdfHex } = data);
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
