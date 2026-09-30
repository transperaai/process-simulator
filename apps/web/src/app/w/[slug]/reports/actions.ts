"use server";

import { headers } from "next/headers";
import { isUuid } from "@/lib/report/options";
import { ReportError, refreshReportLink } from "@/lib/report/server";
import { createClient } from "@/lib/supabase/server";

// A fresh download link for a stored report (issue #28): anyone holding it
// can open the PDF without signing in for 24 hours. Making one replaces the
// report's previous link. Editors, owners and agency admins (RLS).

export async function createReportLink(reportId: string): Promise<{ status: "ok"; url: string; expiresAt: string } | { status: "error"; message: string }> {
  if (!isUuid(reportId)) return { status: "error", message: "That report isn't available." };
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  try {
    const link = await refreshReportLink(await createClient(), reportId, origin, new Date().toISOString());
    return { status: "ok", url: link.url, expiresAt: link.expiresAt };
  } catch (err) {
    if (err instanceof ReportError) return { status: "error", message: err.message };
    throw err;
  }
}
