import type { Database } from "@transpera-flow/db";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Supabase client for the browser, signed in through the session cookies the
 * proxy keeps fresh. Used for Realtime (issue #10) and the reads that go with
 * it; writes stay in Server Actions. Null when Supabase isn't configured.
 */
export function createClient() {
  const env = supabaseEnv();
  // createBrowserClient returns one shared client per page.
  return env ? createBrowserClient<Database>(env.url, env.key) : null;
}
