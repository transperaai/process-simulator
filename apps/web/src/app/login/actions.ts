"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Google sign-in: hand off to Google, which returns to /auth/callback. */
export async function signInWithGoogle(): Promise<void> {
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    // openid makes Google return an ID token, which carries the hosted-domain (hd) claim used for domain joins.
    options: { redirectTo: `${origin}/auth/callback`, scopes: "openid" },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in is unavailable.")}`);
  redirect(data.url);
}
