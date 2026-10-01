"use server";

import { saveAnalysisRules, type AnalysisRules } from "@transpera-flow/db";
import { createClient } from "@/lib/supabase/server";

// Saves a workspace's analysis rules (issue #109). Runs as the signed-in user through RLS: owners and editors
// write, everyone else is refused. The engine's parser checks the document, so a hand-made request can't store
// cut-offs out of order or rules that don't exist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveRulesResult =
  | { status: "saved"; rules: AnalysisRules }
  | { status: "conflict"; rules: AnalysisRules }
  | { status: "error"; message: string };

export async function saveRules(workspaceId: string, settings: unknown, version: string | null): Promise<SaveRulesResult> {
  if (!UUID.test(workspaceId) || !(version === null || typeof version === "string")) return { status: "error", message: "That isn't valid." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { status: "error", message: "Your session has ended. Sign in again." };
  const outcome = await saveAnalysisRules(supabase, workspaceId, settings, version);
  switch (outcome.status) {
    case "saved":
    case "conflict":
      return outcome;
    case "invalid":
      return { status: "error", message: outcome.errors[0] ?? "Those rules aren't valid." };
    case "forbidden":
      return { status: "error", message: "Only owners and editors can change the rules." };
    case "error":
      return outcome;
  }
}
