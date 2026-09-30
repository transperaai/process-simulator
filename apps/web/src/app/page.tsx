import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { isAgencyAdmin, resolveMyAccess } from "@/lib/access-data";
import { listWorkspaces } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { NewWorkspaceForm } from "./new-workspace-form";

export default async function HomePage() {
  // Render per request: Supabase settings are read at runtime, not build time.
  await connection();
  if (!supabaseEnv()) redirect("/demo");
  const [firstLook, admin] = await Promise.all([listWorkspaces(), isAgencyAdmin()]);
  let workspaces = firstLook;
  if (workspaces.length === 0) {
    // Sessions from before access resolution existed never ran it at sign-in.
    if ((await resolveMyAccess()) > 0) workspaces = await listWorkspaces();
  }
  // An agency admin with no workspaces creates the first one here.
  if (workspaces.length === 0 && !admin) {
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    return <HoldingPage email={user?.email ?? "an unknown account"} />;
  }
  return (
    <main className="mx-auto w-full max-w-5xl px-4">
      <AppHeader signedIn />
      <h1 className="mt-6 mb-3 text-xl font-bold">Workspaces</h1>
      {admin && (
        <details className="mb-4 rounded-token border border-line bg-panel p-3 shadow-token" open={workspaces.length === 0}>
          <summary className="cursor-pointer font-semibold">New workspace</summary>
          <div className="pt-3">
            <NewWorkspaceForm />
          </div>
        </details>
      )}
      {workspaces.length === 0 && <p className="text-fg-2">No workspaces yet. Create the first one above.</p>}
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
    </main>
  );
}

/** Signed in, but neither a pre-assigned email nor an allowed domain matched. */
function HoldingPage({ email }: { email: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-fg-3">Transpera Flow</p>
      <h1 className="text-2xl font-bold">No workspace yet</h1>
      <p>
        You&apos;re signed in as <strong>{email}</strong> but don&apos;t have access to a workspace yet. Ask your
        company&apos;s owner or Transpera to add you.
      </p>
      <p className="text-sm text-fg-3">
        Using a personal Google account? Sign out and sign in with your work account instead.
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-token bg-accent px-3 py-2 font-semibold text-accent-fg">
          Sign out
        </button>
      </form>
    </main>
  );
}
