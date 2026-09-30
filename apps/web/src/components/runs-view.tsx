import Link from "next/link";
import type { ModelChange, RunResults, RunRow } from "@transpera-flow/db";
import { formatDays, formatNumber, formatPercent, formatRange, formatWholeCurrency } from "@/lib/format";

// Saved runs (issue #25; docs/PRD.md §4.1, D19): the results someone saw, and
// a "model changed since this run" banner listing what differs in the model
// now. Server-renderable; the demo wraps them in a client component.

export const runDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const SECTION_LABEL: Record<ModelChange["section"], string> = {
  settings: "Company settings",
  demand: "Demand",
  seasonality: "Demand",
  processes: "Processes",
  roles: "Roles",
  services: "Services",
  people: "People",
  clients: "Clients",
  lead_sources: "Demand",
};

/** "Model changed since this run" with every change, grouped; or a quiet note that nothing has. */
export function ModelChangedBanner({ changes, rerunHref }: { changes: ModelChange[]; rerunHref?: string }) {
  if (!changes.length) {
    return (
      <p data-model-changed="false" className="rounded-token border border-good bg-good-soft px-3 py-2">
        The model hasn&apos;t changed since this run: these results still describe it.
      </p>
    );
  }
  const groups = new Map<string, ModelChange[]>();
  for (const c of changes) groups.set(SECTION_LABEL[c.section], [...(groups.get(SECTION_LABEL[c.section]) ?? []), c]);
  return (
    <section data-model-changed="true" aria-labelledby="model-changed" className="rounded-token border border-warn bg-warn-soft px-3 py-2">
      <h2 id="model-changed" className="font-bold">
        Model changed since this run
      </h2>
      <p className="text-fg-2">
        {changes.length === 1 ? "One thing has" : `${changes.length} things have`} changed, so these results may no longer describe the business.
        {rerunHref && (
          <>
            {" "}
            <Link href={rerunHref} className="underline">
              Run the model as it is now
            </Link>
            .
          </>
        )}
      </p>
      <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {[...groups].map(([label, list]) => (
          <div key={label}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{label}</h3>
            <ul className="list-disc pl-5 text-sm">
              {list.map((c) => (
                <li key={`${c.section}:${c.id}:${c.field ?? c.kind}`}>{c.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The results a run saved, as tiles like the KPI strip's. */
export function RunResultsTiles({ results }: { results: RunResults }) {
  const money = (v: number) => formatWholeCurrency(v, results.currency || "GBP");
  const whole = (v: number) => formatNumber(v, 0);
  const days = (h: number) => formatDays(h, results.hours_per_week || 40);
  const weeks = results.horizon_weeks;
  const tiles = [
    { label: `Wins / ${weeks} wks`, value: formatNumber(results.won.mean), detail: formatRange(results.won, whole) },
    { label: "Lost", value: whole(results.lost.mean), detail: formatRange(results.lost, whole) },
    { label: "Cycle time", value: days(results.cycle.mean), detail: `P50 ${days(results.cycle.p50)} · P90 ${days(results.cycle.p90)}` },
    {
      label: "Bottleneck",
      value: results.bottleneck?.role ?? "–",
      detail: results.bottleneck ? `${formatPercent(results.bottleneck.util.mean)} utilised · ${formatRange(results.bottleneck.util, formatPercent)}` : "",
    },
    { label: "New MRR", value: money(results.mrr_added.mean), detail: formatRange(results.mrr_added, money) },
    { label: `Billed / ${weeks} wks`, value: money(results.billed.mean), detail: formatRange(results.billed, money) },
    { label: `Overtime / ${weeks} wks`, value: `${whole(results.overtime_hours.mean)} h`, detail: formatRange(results.overtime_hours, (v) => `${whole(v)} h`) },
  ];
  return (
    <section aria-label="Saved results" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 rounded-token border border-line bg-panel px-3 py-2 shadow-token">
          <p className="font-mono text-[11px] uppercase tracking-widest text-fg-3">{t.label}</p>
          <p className="truncate font-display text-xl font-bold tabular-nums">{t.value}</p>
          <p className="text-xs text-fg-2 tabular-nums">{t.detail}&nbsp;</p>
        </div>
      ))}
      <p className="col-span-full text-xs text-fg-3">Average of {results.reps} replications; ranges are the 10th–90th percentile.</p>
    </section>
  );
}

export type RunListItem = Pick<RunRow, "id" | "name" | "created_at" | "results"> & { changes: number };

/** Saved runs, newest first, each with whether the model has changed since. */
export function RunsTable({ runs, hrefFor, onOpen }: { runs: RunListItem[]; hrefFor?: (id: string) => string; onOpen?: (id: string) => void }) {
  if (!runs.length) {
    return (
      <p className="rounded-token border border-dashed border-line p-4 text-fg-2">
        No saved runs yet. On the process page, “Save this run” keeps the results with a snapshot of the model behind them.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-token border border-line bg-panel shadow-token">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          {hrefFor ? (
            <Link href={hrefFor(r.id)} className="font-semibold hover:underline">
              {r.name}
            </Link>
          ) : (
            <button type="button" onClick={() => onOpen?.(r.id)} className="font-semibold hover:underline">
              {r.name}
            </button>
          )}
          <span className="text-xs text-fg-3">{runDate(r.created_at)}</span>
          <span className="text-sm text-fg-2 tabular-nums">
            {formatNumber(r.results.won.mean)} wins / {r.results.horizon_weeks} wks
            {r.results.bottleneck ? ` · bottleneck ${r.results.bottleneck.role}` : ""}
          </span>
          <span className="grow" />
          {r.changes ? (
            <span className="rounded-full border border-warn bg-warn-soft px-2 text-xs">
              Model changed since ({r.changes} {r.changes === 1 ? "change" : "changes"})
            </span>
          ) : (
            <span className="rounded-full border border-line px-2 text-xs text-fg-2">Model unchanged</span>
          )}
        </li>
      ))}
    </ul>
  );
}
