"use server";

import { refresh } from "next/cache";
import { generateApiToken } from "@transpera-flow/mcp";
import { createClient } from "@/lib/supabase/server";

export type CreateTokenState = { token: string; label: string } | { error: string } | null;

/** Create a personal API token. The token is returned once; only its hash is stored. */
export async function createToken(_prev: CreateTokenState, form: FormData): Promise<CreateTokenState> {
  const label = String(form.get("label") ?? "").trim();
  if (!label || label.length > 100) return { error: "Give the token a name of up to 100 characters." };
  const supabase = await createClient();
  const { token, hash } = generateApiToken();
  // RLS: user_id defaults to the signed-in user and the policy only allows their own.
  const { error } = await supabase.from("api_tokens").insert({ label, token_hash: hash });
  if (error) return { error: error.message };
  refresh();
  return { token, label };
}

/** Revoke one of the signed-in user's tokens (RLS limits the update to their own). */
export async function revokeToken(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  if (error) throw error;
  refresh();
}
