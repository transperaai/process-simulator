"use server";

import { refresh } from "next/cache";
import { loadCompanyModel, loadSuggestions } from "@transpera-flow/db";
import { parseReview, type ReviewOutcome, type ReviewResult } from "@/lib/suggestions/review";
import { createClient } from "@/lib/supabase/server";

// Accepting and rejecting company-model suggestions (issue #25). Runs as the
// signed-in user: `review_suggestions` applies each accepted patch under RLS
// (editors for people, services, clients and demand; owners for company
// settings), stamps the evidence into the values' provenance and audit-logs
// every write. Returns the suggestions and the model as they now are.

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function reviewSuggestions(workspaceId: unknown, ids: unknown, decision: unknown, note: unknown): Promise<ReviewOutcome> {
  if (!isId(workspaceId)) return { status: "error", message: "That workspace isn't valid." };
  const parsed = parseReview(ids, decision, note);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { status: "error", message: "Your session has ended. Sign in again." };

  const { data, error } = await supabase.rpc("review_suggestions", { ids: parsed.ids, decision: parsed.decision, note: parsed.note ?? undefined });
  if (error) return { status: "error", message: error.code === "42501" ? "You don't have permission to review suggestions here." : "Couldn't save. Try again." };

  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name, slug, settings, provenance")
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError || !workspace) return { status: "error", message: "That workspace isn't available." };
  const [suggestions, model] = await Promise.all([loadSuggestions(supabase, workspaceId), loadCompanyModel(supabase, workspace)]);
  // The sidebar's pending count lives in the shared layout, which navigation doesn't re-render.
  refresh();
  return { status: "ok", results: data as unknown as ReviewResult[], suggestions, model };
}
