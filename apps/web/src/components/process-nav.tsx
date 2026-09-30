"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ProcessListing } from "@transpera-flow/db";
import type { CreateProcessResult } from "@/app/w/[slug]/process-actions";

/**
 * The workspace's processes (issue #76): the pipeline and its servicing
 * processes (issue #19), each opening on the canvas, never-published ones in
 * Draft view. Editors can start a new servicing process here.
 */
export function ProcessNav({
  processes,
  current,
  hrefs,
  create,
}: {
  processes: ProcessListing[];
  current: string;
  /** Where each process opens, by id. */
  hrefs: Record<string, string>;
  /** Start a servicing process (signed-in editors only). */
  create?: (prev: CreateProcessResult, form: FormData) => Promise<CreateProcessResult>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <nav aria-label="Processes" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 font-mono text-[11px] uppercase tracking-widest text-fg-3">Processes</span>
      {processes.map((p) => {
        const here = p.id === current;
        return (
          <Link
            key={p.id}
            href={hrefs[p.id]!}
            aria-current={here ? "page" : undefined}
            className={`rounded-token border px-2 py-0.5 ${here ? "border-accent bg-accent-soft font-semibold" : "border-line bg-panel hover:bg-panel-2"}`}
          >
            {p.name}
            {p.kind === "servicing" && <span className="ml-1.5 text-xs text-fg-3">servicing</span>}
            {!p.live && <span className="ml-1.5 rounded-token bg-warn-soft px-1 text-xs">not published</span>}
          </Link>
        );
      })}
      {create &&
        (adding ? (
          <NewServicingProcess create={create} onCancel={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="rounded-token border border-dashed border-line px-2 py-0.5 text-fg-2 hover:bg-panel-2">
            + Servicing process
          </button>
        ))}
    </nav>
  );
}

function NewServicingProcess({
  create,
  onCancel,
}: {
  create: (prev: CreateProcessResult, form: FormData) => Promise<CreateProcessResult>;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(create, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor="new-servicing-name">
        Name of the servicing process
      </label>
      <input
        id="new-servicing-name"
        name="name"
        required
        maxLength={120}
        autoFocus
        placeholder="e.g. Quarterly review"
        className="w-48 rounded-token border border-line bg-panel px-2 py-0.5"
      />
      <button type="submit" disabled={pending} className="rounded-token bg-accent px-2 py-0.5 font-semibold text-accent-fg disabled:opacity-60">
        {pending ? "Creating…" : "Create"}
      </button>
      <button type="button" onClick={onCancel} className="rounded-token border border-line px-2 py-0.5">
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}
