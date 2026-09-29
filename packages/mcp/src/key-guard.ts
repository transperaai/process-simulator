// Decision D12: the MCP path acts as the user under RLS and never holds a key
// that bypasses it. Refuse to run with a secret or elevated key, so a
// misconfigured environment fails loudly instead of exposing every workspace.

/** Throws unless `key` looks like a publishable (or legacy anon) key. */
export function assertPublishableKey(key: string): void {
  if (key.startsWith("sb_secret_")) throw new Error("The MCP server must use the publishable key, not a secret key");
  const parts = key.split(".");
  if (parts.length !== 3) return;
  let role: unknown;
  try {
    role = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")).role;
  } catch {
    return;
  }
  if (role !== "anon") throw new Error(`The MCP server must use the anon/publishable key, not a '${String(role)}' key`);
}
