"use client";

// The Sources screen (docs/PRD.md §8 screen 7, issue #21): transcripts, notes
// and screenshots from the audit, each with every value that cites it, so
// any inferred number can be traced to what someone said.

import { useState } from "react";
import { EVIDENCE_LABELS, formatParameter, isEvidenceColumn, type SourceCitation, type SourceKind, type SourceRow } from "@transpera-flow/db";
import { DateField, SelectField, TextField } from "@/components/fields";
import type { Saver } from "@/lib/fields/field-controller";
import { liveSourceStore } from "@/lib/sources/live-store";
import { MemorySourceStore, sourceFieldValue, type SourceStore } from "@/lib/sources/store";
import { SOURCE_KIND_LABELS, SOURCE_KINDS, parseSpeakers, type SourceField } from "@/lib/sources/validate";

const button = "rounded-token border border-line bg-panel px-2 py-1 font-semibold hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-fg-3";
const primary = "rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60";
const inputClass = "rounded-token border border-line bg-panel px-2 py-1.5";
const kindOptions = SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_KIND_LABELS[k] }));

const FIELD_NAMES: Record<string, string> = {
  volume_week: "leads a week",
  conversion_to_qualified: "conversion to qualified",
  multiplier: "multiplier",
  growth_monthly: "monthly growth",
};

/** "Audit & proposal · hands-on time". */
const citedWhat = (c: SourceCitation) =>
  `${c.rowName} · ${isEvidenceColumn(c.column) ? EVIDENCE_LABELS[c.column] : (FIELD_NAMES[c.column] ?? c.column)}`;
const statedValue = (c: SourceCitation) =>
  typeof c.value === "number" ? (isEvidenceColumn(c.column) ? formatParameter(c.column, c.value) : String(c.value)) : null;

export function SourcesPage({
  workspaceId,
  sources: initial,
  citations,
  mode,
  processHref,
}: {
  workspaceId: string;
  sources: SourceRow[];
  /** What cites each source, by source id. */
  citations: Record<string, SourceCitation[]>;
  mode: "live" | "demo" | "readonly";
  /** Link to the process page, so a citing step can be opened. */
  processHref?: string;
}) {
  const canEdit = mode !== "readonly";
  const [store] = useState<SourceStore>(() => (mode === "live" ? liveSourceStore(workspaceId) : new MemorySourceStore(workspaceId, initial)));
  const [sources, setSources] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const cited = new Set(Object.keys(citations));
  const orphans = Object.entries(citations).filter(([id]) => !sources.some((s) => s.id === id));

  const saver =
    (id: string, field: SourceField): Saver<string | null> =>
    async (base, next) => {
      const outcome = await store.saveField(id, field, base, next);
      if (outcome.status === "saved") {
        const value = field === "speakers" ? parseSpeakers(outcome.value as string | null) : outcome.value;
        setSources((list) => list.map((s) => (s.id === id ? ({ ...s, [field]: value } as SourceRow) : s)));
      }
      return outcome as Awaited<ReturnType<Saver<string | null>>>;
    };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <AddSource
          onAdd={async (input) => {
            const r = await store.create(input);
            if (r.status === "error") return r.message;
            setSources((list) => [r.source, ...list]);
            return null;
          }}
        />
      ) : (
        <p className="text-fg-2">You can read the sources here; owners and editors can add and change them.</p>
      )}
      {error && (
        <p role="alert" className="rounded-token border border-crit bg-crit-soft p-2">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {sources.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-4 text-fg-2">
          No sources yet. Add the audit&apos;s transcripts and notes, then cite them from a step&apos;s inspector (or let
          Claude cite them through the MCP server) so every number can be traced to what someone said.
        </p>
      ) : (
        <ul aria-label="Sources" className="flex flex-col gap-3">
          {sources.map((s) => (
            <li key={s.id}>
              <SourceItem
                source={s}
                citations={citations[s.id] ?? []}
                canEdit={canEdit}
                saver={saver}
                processHref={processHref}
                onRemove={async () => {
                  const r = await store.remove(s.id);
                  if (r.status === "error") setError(r.message);
                  else setSources((list) => list.filter((x) => x.id !== s.id));
                }}
                cited={cited.has(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {orphans.length > 0 && (
        <section aria-label="Citations of deleted sources" className="rounded-token border border-warn bg-warn-soft p-3 text-xs">
          <h2 className="mb-1 text-sm font-bold">Citing a deleted source</h2>
          <Citations citations={orphans.flatMap(([, list]) => list)} processHref={processHref} />
        </section>
      )}
    </div>
  );
}

function SourceItem({
  source: s,
  citations,
  canEdit,
  saver,
  onRemove,
  processHref,
  cited,
}: {
  source: SourceRow;
  citations: SourceCitation[];
  canEdit: boolean;
  saver: (id: string, field: SourceField) => Saver<string | null>;
  onRemove: () => Promise<void>;
  processHref?: string;
  cited: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const value = (f: SourceField) => sourceFieldValue(s, f) as string | null;
  return (
    <article aria-label={s.title} className="rounded-token border border-line bg-panel p-3 shadow-token">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded-full border border-line px-1.5 text-[11px] font-semibold text-fg-2">{SOURCE_KIND_LABELS[s.kind]}</span>
        <h2 className="text-base font-bold">{s.title}</h2>
        {s.recorded_at && <span className="text-fg-3 tabular-nums">{s.recorded_at}</span>}
        {s.speakers.length > 0 && <span className="text-fg-2">{s.speakers.join(", ")}</span>}
        <span className="ml-auto text-fg-3">
          {citations.length ? `Cited by ${citations.length} value${citations.length === 1 ? "" : "s"}` : "Not cited yet"}
        </span>
      </header>
      <Citations citations={citations} processHref={processHref} />
      <details className="mt-2">
        <summary className="cursor-pointer text-fg-2 hover:underline">{canEdit ? "Details and edit" : "Details"}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <TextField label="Title" value={s.title} save={saver(s.id, "title")} disabled={!canEdit} />
          <SelectField
            label="Kind"
            value={s.kind}
            options={kindOptions}
            save={saver(s.id, "kind")}
            disabled={!canEdit}
          />
          <TextField
            label="Speakers"
            value={value("speakers")}
            optional
            save={saver(s.id, "speakers")}
            disabled={!canEdit}
            hint="Comma-separated."
          />
          <DateField label="Date" value={s.recorded_at} save={saver(s.id, "recorded_at")} disabled={!canEdit} />
          <div className="sm:col-span-2">
            <TextField label="Link (file or recording)" value={s.file_url} optional save={saver(s.id, "file_url")} disabled={!canEdit} />
            {s.file_url && (
              <a href={s.file_url} target="_blank" rel="noreferrer noopener" className="text-xs text-accent underline">
                Open {s.kind === "screenshot" ? "the screenshot" : "the file"}
              </a>
            )}
          </div>
          <div className="sm:col-span-2">
            <TextField label="Transcript or notes" value={s.body} optional multiline save={saver(s.id, "body")} disabled={!canEdit} />
          </div>
        </div>
        {canEdit &&
          (confirming ? (
            <div role="alertdialog" aria-label={`Delete ${s.title}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-token border border-crit bg-crit-soft p-2">
              <p className="grow">
                Delete this source?{" "}
                {cited ? "The values citing it keep their quotes, listed as citing a deleted source." : "Nothing cites it."}
              </p>
              <button type="button" className="rounded-token border border-crit px-2 py-1 font-semibold text-crit" onClick={() => void onRemove()}>
                Delete source
              </button>
              <button type="button" className={button} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className="mt-2 rounded-token border border-crit px-2 py-1 text-crit hover:bg-crit-soft" onClick={() => setConfirming(true)}>
              Delete source…
            </button>
          ))}
      </details>
    </article>
  );
}

function Citations({ citations, processHref }: { citations: SourceCitation[]; processHref?: string }) {
  if (!citations.length) return null;
  return (
    <ul aria-label="Values citing this source" className="mt-2 flex flex-col gap-1.5">
      {citations.map((c, i) => {
        const value = statedValue(c);
        const what = citedWhat(c);
        return (
          <li key={`${c.table}:${c.rowId}:${c.column}:${i}`} className="rounded-token bg-panel-2 px-2 py-1.5 text-xs">
            <p className="flex flex-wrap items-baseline gap-x-2">
              {c.processId && processHref ? (
                <a href={processHref} className="font-semibold hover:underline">
                  {what}
                </a>
              ) : (
                <span className="font-semibold">{what}</span>
              )}
              {value && <span className="tabular-nums text-fg-2">says {value}</span>}
              {c.revision === "draft" && <span className="rounded-full border border-dashed border-accent px-1 text-[10px]">draft only</span>}
            </p>
            <blockquote className="mt-0.5 text-fg-2">
              “{c.quote}”{c.speaker ? <span className="text-fg-3"> · {c.speaker}</span> : null}
              {c.timestamp ? <span className="text-fg-3 tabular-nums"> · {c.timestamp}</span> : null}
            </blockquote>
          </li>
        );
      })}
    </ul>
  );
}

function AddSource({ onAdd }: { onAdd: (input: { kind: SourceKind; title: string; speakers: string[]; recorded_at: string | null; body: string | null; file_url: string | null }) => Promise<string | null> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label="Add a source"
      className="grid gap-2 rounded-token border border-line bg-panel p-3 shadow-token sm:grid-cols-[8rem_1fr_1fr_10rem]"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const text = (k: string) => {
          const v = String(data.get(k) ?? "").trim();
          return v || null;
        };
        setPending(true);
        const problem = await onAdd({
          kind: (text("kind") ?? "transcript") as SourceKind,
          title: text("title") ?? "",
          speakers: parseSpeakers(text("speakers")),
          recorded_at: text("recorded_at"),
          body: text("body"),
          file_url: text("file_url"),
        });
        setPending(false);
        setError(problem);
        if (!problem) form.reset();
      }}
    >
      <h2 className="text-sm font-bold sm:col-span-4">Add a source</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Kind</span>
        <select name="kind" className={inputClass} defaultValue="transcript">
          {kindOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Title</span>
        <input name="title" required maxLength={200} className={inputClass} placeholder="Discovery interview" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Speakers</span>
        <input name="speakers" className={inputClass} placeholder="Maya Collins, Rosa Diaz" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Date</span>
        <input name="recorded_at" type="date" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-4">
        <span className="text-xs font-medium text-fg-2">Transcript or notes</span>
        <textarea name="body" rows={3} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-3">
        <span className="text-xs font-medium text-fg-2">Link to a file or screenshot (optional)</span>
        <input name="file_url" type="url" className={inputClass} placeholder="https://" />
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Adding…" : "Add source"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-crit sm:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}

