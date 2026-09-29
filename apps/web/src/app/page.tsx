import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { listWorkspaces } from "@/lib/data";
import { supabaseEnv } from "@/lib/supabase/env";

export default async function HomePage() {
  // Render per request: Supabase settings are read at runtime, not build time.
  await connection();
  if (!supabaseEnv()) redirect("/demo");
  const workspaces = await listWorkspaces();
  return (
    <main className="mx-auto w-full max-w-5xl px-4">
      <AppHeader signedIn />
      <h1 className="mt-6 mb-3 text-xl font-bold">Workspaces</h1>
      {workspaces.length === 0 ? (
        <p className="text-fg-2">You don&apos;t have access to any workspaces yet. Ask an agency admin to add you.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <Link
                href={`/w/${ws.slug}`}
                className="block rounded-token border border-line bg-panel px-4 py-3 font-semibold shadow-token hover:border-fg-3"
              >
                {ws.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
