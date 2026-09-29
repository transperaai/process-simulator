import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { revokeToken } from "./actions";
import { CreateTokenForm } from "./create-token-form";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

export default async function ApiTokensPage() {
  await connection();
  if (!supabaseEnv()) redirect("/demo");
  const supabase = await createClient();
  const { data: tokens, error } = await supabase
    .from("api_tokens")
    .select("id, label, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const endpoint = `${proto}://${host}/api/mcp`;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-8">
      <AppHeader signedIn />
      <h1 className="mt-6 mb-1 text-xl font-bold">API tokens</h1>
      <p className="mb-4 max-w-2xl text-fg-2">
        Personal tokens let Claude Code or Claude desktop use Transpera Flow as you, through the MCP server at{" "}
        <code className="font-mono text-sm">{endpoint}</code>. A token sees exactly what you can see. Revoke any token you no longer use.
      </p>
      <CreateTokenForm endpoint={endpoint} />
      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-fg-3">
          <tr>
            <th className="py-1 font-normal">Name</th>
            <th className="py-1 font-normal">Created</th>
            <th className="py-1 font-normal">Last used</th>
            <th className="py-1 font-normal">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-fg-2">
                No tokens yet.
              </td>
            </tr>
          )}
          {tokens.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <td className="py-2">{t.label}</td>
              <td className="py-2 tabular-nums">{date(t.created_at)}</td>
              <td className="py-2 tabular-nums">{date(t.last_used_at)}</td>
              <td className="py-2">{t.revoked_at ? `Revoked ${date(t.revoked_at)}` : "Active"}</td>
              <td className="py-2 text-right">
                {!t.revoked_at && (
                  <form action={revokeToken}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="rounded-token px-2 py-1 text-crit hover:bg-panel-2">
                      Revoke
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
