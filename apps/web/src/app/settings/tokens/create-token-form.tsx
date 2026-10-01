"use client";

import { useActionState, useId } from "react";
import { Help } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createToken, type CreateTokenState } from "./actions";

export function CreateTokenForm({ endpoint }: { endpoint: string }) {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(createToken, null);
  const created = state && "token" in state ? state : null;
  const id = useId();

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="flex items-center">
            <label htmlFor={id} className="text-xs font-medium text-fg-2">
              Name
            </label>
            <Help
              label="Token name"
              description="A name to remember what this token is for, so you can tell tokens apart and revoke the right one."
              example="Claude Code on my laptop"
            />
          </span>
          <Input id={id} name="label" required maxLength={100} placeholder="e.g. Claude Code on my laptop" className="w-full sm:w-72" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create token"}
        </Button>
      </form>
      {state && "error" in state && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {created && (
        <div role="status" className="rounded-lg border bg-muted/50 p-3 text-sm">
          <p className="font-medium">Copy “{created.label}” now. It won&apos;t be shown again.</p>
          <code className="mt-2 block rounded-md bg-card p-2 font-mono break-all ring-1 ring-foreground/10">{created.token}</code>
          <p className="mt-3 text-muted-foreground">Connect Claude Code:</p>
          <code className="mt-1 block rounded-md bg-card p-2 font-mono text-xs break-all ring-1 ring-foreground/10">
            {`claude mcp add --transport http transpera-flow ${endpoint} --header "Authorization: Bearer ${created.token}"`}
          </code>
        </div>
      )}
    </div>
  );
}
