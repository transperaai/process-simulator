"use client";

import { useState } from "react";
import { checkReportSummary, saveReportSummary, type SummaryActionResult } from "@/app/w/[slug]/reports/actions";
import type { ExecutiveSummary } from "@/lib/report/content";
import type { NumberProblem } from "@/lib/narration/numbers";

// Narration in the app (issue #29; docs/PRD.md §7.3, §8 screen 12): the
// report's executive summary with how it was written, a "Draft with Claude"
// action (on demand, server-side), and an editor whose text is checked
// against the report's figures before it saves; and "explain this run".

const button = "rounded-token border border-line bg-panel px-3 py-1.5 font-semibold hover:bg-panel-2 disabled:opacity-50";
const primary = "rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50";

/** Numbers that failed the check, in words. */
export function ProblemList({ problems }: { problems: NumberProblem[] }) {
  if (!problems.length) return null;
  return (
    <div role="alert" data-problems className="rounded-token border border-crit bg-crit-soft px-3 py-2 text-sm">
      <p className="font-semibold">These figures aren&apos;t in the report as written, so the text can&apos;t print:</p>
      <ul className="list-disc pl-5">
        {problems.map((p, i) => (
          <li key={`${p.text}-${i}`}>
            <span className="font-mono">{p.text}</span>: {p.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How the summary was written: templated, narrated and checked, or the template after a failed narration. */
export function SummaryProvenance({ summary }: { summary: ExecutiveSummary }) {
  const n = summary.narration;
  return (
    <div className="flex flex-col gap-1 text-sm" data-summary-source={summary.source}>
      {summary.source === "narration" && n ? (
        <p>
          <span className="rounded-token bg-accent-soft px-1.5 py-0.5 font-semibold">Narrated by {n.model}</span>{" "}
          <span className="text-fg-2">
            {n.checked} {n.checked === 1 ? "figure" : "figures"} checked against the report{n.retried ? "; a first draft with figures not in the report was rejected" : ""}.
          </span>
        </p>
      ) : (
        <p>
          <span className="rounded-token bg-panel-2 px-1.5 py-0.5 font-semibold">Templated text</span>{" "}
          <span className="text-fg-2">filled in from the run; no language model.</span>
        </p>
      )}
      {n?.fallbackReason && (
        <p className="rounded-token border border-warn bg-warn-soft px-2 py-1" data-fallback-reason>
          Narration wasn&apos;t used: {n.fallbackReason}. The templated summary prints instead.
        </p>
      )}
      {summary.editedBy && <p className="text-fg-2">Edited by {summary.editedBy}; the appendix says so.</p>}
    </div>
  );
}

/** The report's executive summary: read, draft with Claude, edit (checked), save and re-print. */
export function SummaryEditor({
  reportId,
  initial,
  configured,
  canNarrate,
  printUrl,
}: {
  reportId: string;
  initial: ExecutiveSummary;
  /** The server has an Anthropic API key. */
  configured: boolean;
  /** The report has a saved run to narrate. */
  canNarrate: boolean;
  printUrl: string;
}) {
  const [summary, setSummary] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "narrate" | "check" | "save">(null);
  const [problems, setProblems] = useState<NumberProblem[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const narrate = async (regenerate: boolean) => {
    setBusy("narrate");
    setMessage(null);
    try {
      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "report", reportId, regenerate }),
      });
      const body = await res.json().catch(() => null);
      if (!body || body.status !== "ok") setMessage({ tone: "error", text: body?.message ?? `Narration failed (${res.status}).` });
      else {
        setSummary(body.summary);
        setMessage(
          body.summary.source === "narration"
            ? { tone: "ok", text: `${body.narration?.cached ? "Narration from the cache" : "Narrated"}; the PDF is re-printed.` }
            : { tone: "error", text: "The templated summary is kept (see why above)." },
        );
      }
    } catch {
      setMessage({ tone: "error", text: "The request failed. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: "check" | "save") => {
    if (editing === null) return;
    setBusy(kind);
    setMessage(null);
    const result: SummaryActionResult = kind === "check" ? await checkReportSummary(reportId, editing) : await saveReportSummary(reportId, editing);
    setBusy(null);
    if (result.status === "invalid") {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    if (result.status === "error") setMessage({ tone: "error", text: result.message });
    else if (kind === "check") setMessage({ tone: "ok", text: `All ${result.checked} figures match the report.` });
    else {
      setSummary(result.summary);
      setEditing(null);
      setMessage({ tone: result.pdfError ? "error" : "ok", text: result.pdfError ? `Saved; the PDF couldn't be re-printed (${result.pdfError}).` : "Saved and the PDF re-printed." });
    }
  };

  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-3 rounded-token border border-line bg-panel p-3 shadow-token">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="summary-heading" className="text-lg font-bold">
          Executive summary
        </h2>
        <a href={printUrl} className="text-sm underline" target="_blank" rel="noreferrer">
          Open printable report
        </a>
      </div>
      <SummaryProvenance summary={summary} />
      {editing === null ? (
        <div className="flex flex-col gap-2" data-summary-text>
          {summary.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-2">Paragraphs separated by a blank line. Every figure must be one the report prints (rounding as it does is fine).</span>
          <textarea
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            rows={Math.min(24, Math.max(8, editing.split("\n").length + 2))}
            className="rounded-token border border-line bg-panel px-2 py-1 font-sans text-base"
            aria-label="Executive summary"
          />
        </label>
      )}
      <ProblemList problems={problems} />
      <div className="flex flex-wrap items-center gap-2">
        {editing === null ? (
          <>
            <button type="button" className={button} onClick={() => setEditing(summary.paragraphs.join("\n\n"))} disabled={busy !== null}>
              Edit
            </button>
            {canNarrate && (
              <button
                type="button"
                className={primary}
                disabled={busy !== null || !configured}
                onClick={() => void narrate(summary.source === "narration")}
                title={configured ? undefined : "Narration needs ANTHROPIC_API_KEY on the server"}
              >
                {busy === "narrate" ? "Drafting…" : summary.source === "narration" ? "Redraft with Claude" : "Draft with Claude"}
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className={primary} onClick={() => void run("save")} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save and re-print"}
            </button>
            <button type="button" className={button} onClick={() => void run("check")} disabled={busy !== null}>
              {busy === "check" ? "Checking…" : "Check figures"}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setEditing(null);
                setProblems([]);
              }}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </>
        )}
        <span role="status" aria-live="polite" className={`text-sm ${message?.tone === "error" ? "text-crit" : "text-fg-2"}`}>
          {busy === "narrate" ? "Claude drafts from the report's figures; every number is checked, with one redraft if needed (up to a minute or so)." : message?.text}
        </span>
      </div>
      {canNarrate && !configured && (
        <p className="text-sm text-fg-2" data-narration-unconfigured>
          Narration needs the Anthropic API key on the server (<code>ANTHROPIC_API_KEY</code>); until then the templated summary prints.
        </p>
      )}
    </section>
  );
}

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
