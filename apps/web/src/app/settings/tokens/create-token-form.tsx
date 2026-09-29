"use client";

import { useActionState } from "react";
import { createToken, type CreateTokenState } from "./actions";

export function CreateTokenForm({ endpoint }: { endpoint: string }) {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(createToken, null);
  const created = state && "token" in state ? state : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-2">Name</span>
          <input
            name="label"
            required
            maxLength={100}
            placeholder="e.g. Claude Code on my laptop"
            className="w-72 rounded-token border border-line bg-panel px-2 py-1"
          />
        </label>
        <button type="submit" disabled={pending} className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60">
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
      {state && "error" in state && (
        <p role="alert" className="text-sm text-crit">
          {state.error}
        </p>
      )}
      {created && (
        <div role="status" className="rounded-token border border-line bg-panel-2 p-3 text-sm">
          <p className="font-semibold">Copy “{created.label}” now. It won&apos;t be shown again.</p>
          <code className="mt-2 block break-all rounded-token bg-panel p-2 font-mono">{created.token}</code>
          <p className="mt-3 text-fg-2">Connect Claude Code:</p>
          <code className="mt-1 block break-all rounded-token bg-panel p-2 font-mono text-xs">
            {`claude mcp add --transport http transpera-flow ${endpoint} --header "Authorization: Bearer ${created.token}"`}
          </code>
        </div>
      )}
    </div>
  );
}
