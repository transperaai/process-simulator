"use client";

import { useState } from "react";

// Narration in the app (issue #29; docs/PRD.md §7.3): "explain this run", on demand and server-side.

const button = "rounded-token border border-line bg-panel px-3 py-1.5 font-semibold hover:bg-panel-2 disabled:opacity-50";
const primary = "rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50";

export interface ExplanationView {
  source: "narration" | "template";
  paragraphs: string[];
  fallback: boolean;
  reason: string | null;
  cached: boolean;
  model: string | null;
  checked: number;
  retried: boolean;
}

/** "Explain this run" on a saved run: Claude through POST /api/narrate. */
export function LiveExplainRun({ runId, initial, canDraft, configured }: { runId: string; initial: ExplanationView | null; canDraft: boolean; configured: boolean }) {
  return (
    <ExplainRun
      initial={initial}
      canDraft={canDraft}
      configured={configured}
      request={async (regenerate) => {
        const res = await fetch("/api/narrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "run", runId, regenerate }),
        });
        const body = await res.json().catch(() => null);
        return body?.status === "ok" ? { status: "ok", narration: body.narration } : { status: "error", message: body?.message ?? `The explanation failed (${res.status}).` };
      }}
    />
  );
}

/** "Explain this run": a cached explanation, or a new one on demand. `request` calls the server (Claude, or the demo's stand-in). */
export function ExplainRun({
  initial,
  canDraft,
  configured,
  request,
  note,
}: {
  initial: ExplanationView | null;
  canDraft: boolean;
  configured: boolean;
  request: (regenerate: boolean) => Promise<{ status: "ok"; narration: ExplanationView } | { status: "error"; message: string }>;
  /** Shown under the text (e.g. the demo's stand-in notice). */
  note?: string;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (regenerate: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await request(regenerate);
      if (res.status === "ok") setView(res.narration);
      else setError(res.message);
    } catch {
      setError("The request failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="explain-heading" className="flex flex-col gap-2 rounded-token border border-line bg-panel p-3 shadow-token" data-explain>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="explain-heading" className="font-bold">
          Explain this run
        </h2>
        {canDraft && (
          <button type="button" className={view ? button : primary} disabled={busy || !configured} onClick={() => void ask(Boolean(view))}>
            {busy ? "Explaining…" : view ? "Explain again" : "Explain this run"}
          </button>
        )}
      </div>
      {view ? (
        <>
          <p className="text-sm text-fg-2" data-summary-source={view.source}>
            {view.source === "narration"
              ? `Written by ${view.model}; all ${view.checked} figures checked against the run${view.cached ? " (from the cache)" : ""}.`
              : "Templated text from the run's figures."}
          </p>
          {view.fallback && view.reason && (
            <p className="rounded-token border border-warn bg-warn-soft px-2 py-1 text-sm" data-fallback-reason>
              Narration wasn&apos;t used: {view.reason}.
            </p>
          )}
          {view.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </>
      ) : (
        <p className="text-sm text-fg-2">
          {canDraft
            ? "Claude can explain this run's results in plain words. Every number it writes is checked against the run; anything it can't back up is rejected."
            : "No explanation yet. An editor can ask for one."}
        </p>
      )}
      {canDraft && !configured && (
        <p className="text-sm text-fg-2" data-narration-unconfigured>
          Narration needs the Anthropic API key on the server (<code>ANTHROPIC_API_KEY</code>).
        </p>
      )}
      {note && <p className="text-xs text-fg-3">{note}</p>}
      {error && (
        <p role="alert" className="text-sm text-crit">
          {error}
        </p>
      )}
    </section>
  );
}
