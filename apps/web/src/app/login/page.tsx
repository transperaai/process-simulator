import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Render per request: Supabase settings are read at runtime, not build time.
  await connection();
  if (!supabaseEnv()) redirect("/demo");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-fg-3">Flowsim</p>
        <h1 className="text-2xl font-bold">Sign in</h1>
      </div>
      <LoginForm />
    </main>
  );
}
