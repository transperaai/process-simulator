"use client";

import { useActionState, useState } from "react";
import { slugify } from "@/lib/workspaces";
import { createWorkspace, type CreateWorkspaceState } from "./actions";

const input = "rounded-token border border-line bg-panel px-2 py-1.5";

/** The new-workspace form. The address follows the name until someone edits it. */
export function NewWorkspaceForm() {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input
          name="name"
          required
          maxLength={200}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          className={input}
        />
      </label>
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Address</span>
        <span className="flex items-center gap-1">
          <span className="text-fg-3">/w/</span>
          <input
            name="slug"
            maxLength={60}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={`${input} min-w-0 flex-1`}
          />
        </span>
      </label>
      <label className="flex w-28 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Hours a week</span>
        <input name="hours_per_week" type="number" inputMode="decimal" min={1} max={168} step="any" placeholder="40" className={`${input} tabular-nums`} />
      </label>
      <label className="flex w-24 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Currency</span>
        <input name="currency" maxLength={3} placeholder="GBP" className={`${input} uppercase`} />
      </label>
      <label className="flex w-28 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Horizon (weeks)</span>
        <input name="horizon_weeks" type="number" inputMode="numeric" min={1} max={104} step={1} placeholder="13" className={`${input} tabular-nums`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60">
        {pending ? "Creating…" : "Create workspace"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}
