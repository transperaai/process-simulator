"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  status: "idle" | "sent" | "error";
  email?: string;
  message?: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Step 1 of email sign-in: send a one-time code. */
export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return { status: "error", message: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) return { status: "error", message: error.message };
  return { status: "sent", email, message: `We emailed a sign-in code to ${email}.` };
}

/** Step 2 of email sign-in: check the code and start the session. */
export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = prev.email ?? "";
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(token)) return { ...prev, status: "sent", message: "Enter the code from the email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ...prev, status: "sent", message: error.message };
  redirect("/");
}

/** Google sign-in: hand off to Google, which returns to /auth/callback. */
export async function signInWithGoogle(): Promise<void> {
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in is unavailable.")}`);
  redirect(data.url);
}
