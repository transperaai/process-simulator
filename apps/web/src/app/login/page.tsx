import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Render per request: Supabase settings are read at runtime, not build time.
  await connection();
  if (!supabaseEnv()) redirect("/demo");
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-fg-3">Transpera Flow</p>
        <h1 className="text-2xl font-bold">Sign in</h1>
      </div>
      {error ? (
        <p role="alert" className="text-crit">
          Sign-in failed: {error} Please try again.
        </p>
      ) : null}
      <LoginForm />
      <a href="/privacy" className="text-xs text-fg-3 underline">
        Privacy policy
      </a>
    </main>
  );
}
