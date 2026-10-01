"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Help } from "@/components/help";
import { HistoryChart } from "@/components/history/history-chart";
import { DuplicateDialog, RestoreDialog, type VersionActions, type VersionLinks } from "@/components/history/version-dialogs";
import { HorizonPicker } from "@/components/horizon-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { horizonWeeks } from "@/lib/horizon";
import { useVersionRuns, type VersionModel } from "@/lib/history/use-version-runs";
import { AUTO_RUN_VERSIONS, HISTORY_REPS, authorLabel, autoRunIds, describeChanges, formatPublished, versionLabel, type Measure, type RunEntry, type VersionMeta } from "@/lib/history/versions";

/**
 * The History screen's body (issue #105): two charts of the headline measures by version, then the table of
 * published versions. The newest versions are simulated here in the browser as soon as the page opens; older
 * ones say "Not run" until someone presses Run. Editors also get Restore and Duplicate.
 */
export function HistoryView({
  processName,
  versions,
  models,
  loadModel,
  viewBase,
  actions,
  links,
  note,
}: {
  processName: string;
  /** Newest first. */
  versions: VersionMeta[];
  /** Models of the versions simulated up front. */
  models: Record<string, VersionModel>;
  /** Fetch an older version's model (a server action); omitted when every version's model is in `models`. */
  loadModel?: (revisionId: string) => Promise<VersionModel>;
  /** The process page; View adds `?version=N`. */
  viewBase: string;
  /** Restore and Duplicate; omitted for people who can't edit, who then see neither. */
  actions?: VersionActions;
  links: VersionLinks;
  /** A line under the table, such as the demo's reminder that nothing is kept. */
  note?: string;
}) {
  const [months, setMonths] = useState<number | null>(null);
  const weeks = months === null ? null : horizonWeeks(months);
  const auto = useMemo(() => autoRunIds(versions, AUTO_RUN_VERSIONS), [versions]);
  const { entries, run } = useVersionRuns({ models, auto, weeks, loadModel });
  const [dialog, setDialog] = useState<{ kind: "restore" | "duplicate"; version: VersionMeta } | null>(null);

  const ownWeeks = Object.values(models).flatMap((m) => ("model" in m ? [m.model.horizonWeeks] : []))[0] ?? 13;
  const oldestFirst = [...versions].sort((a, b) => a.number - b.number);
  const firstNumber = oldestFirst[0]?.number;
  const measureOf = (v: VersionMeta, pick: (h: NonNullable<Extract<RunEntry, { status: "done" }>["headline"]>) => Measure) => {
    const e = entries[v.revisionId];
    return e?.status === "done" ? pick(e.headline) : null;
  };
  const pending = auto.filter((id) => entries[id]?.status !== "done" && entries[id]?.status !== "error").length;

  if (versions.length === 0) {
    return (
      <p className="rounded-token border border-dashed border-line p-6 text-sm text-muted-foreground">
        {processName} hasn&apos;t been published yet, so it has no history. Publish its first version from the Editor.
      </p>
    );
  }

  const winsHelp = (
    <Help
      label="Wins per month"
      description="New clients won per month when this version's process is simulated, the same way the map does it. The line is the average and the band is the range across the simulated runs."
      example="4.2 with a band of 3.1 to 5.6 means about four new clients a month, and a good or bad stretch could give anywhere from three to nearly six."
    />
  );
  const cycleHelp = (
    <Help
      label="Lead to win"
      description="Working days from a lead arriving to the deal being won. The line is the average; the band runs from a typical lead to a slow one."
      example="19 days with a band of 14 to 31 means most deals close in about two to three weeks, and the slow ones take over a month."
    />
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Every published version, with its simulated results. {actions ? "Restore one, or duplicate it as a new process." : "Open one to see how it looked."}
        </p>
        <HorizonPicker weeks={weeks ?? ownWeeks} onChange={setMonths} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <HistoryChart
          title="New clients won per month, by version"
          help={winsHelp}
          unit="wins per month"
          format={(v) => formatNumber(v, 1)}
          pending={pending}
          data={oldestFirst.map((v) => ({ label: versionLabel(v.number), measure: measureOf(v, (h) => h.winsPerMonth) }))}
        />
        <HistoryChart
          title="Lead to win, days, by version"
          help={cycleHelp}
          unit="days"
          format={(v) => formatNumber(v, v < 10 ? 1 : 0)}
          pending={pending}
          data={oldestFirst.map((v) => ({ label: versionLabel(v.number), measure: measureOf(v, (h) => h.leadToWinDays) }))}
        />
      </div>

      <div className="relative overflow-x-auto rounded-token border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Version
                <Help
                  label="Version"
                  description="Each time you publish the Editor's draft it becomes the next version. Live is the one people see and simulate today. Older versions are kept."
                  example="v4 · Live is the current process; v3 is how it was before the last publish."
                />
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Published</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                By
                <Help
                  label="By"
                  description="Who published the version: a person on your team, or Claude (MCP) when it was published through the connected Claude."
                  example="Claude (MCP) means it came in through Claude's connection rather than from the Editor."
                />
              </th>
              <th className="px-3 py-2 font-medium">
                What changed
                <Help
                  label="What changed"
                  description="How the version differs from the one before it: steps changed, added or removed, and connections between steps."
                  example="2 steps changed, 1 added means two steps got new times or rules and one new step appeared."
                />
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                Wins / mo
                <Help
                  label="Wins per month in the table"
                  description="New clients won per month, as simulated for this version. The smaller figure under it is the range."
                  example="4.2 with 3.1–5.6 under it."
                />
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                Lead to win
                <Help
                  label="Lead to win in the table"
                  description="Working days from a lead to a won deal, as simulated for this version. The smaller figure under it is the range from a typical lead to a slow one."
                  example="19 d with 14–31 under it."
                />
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                <span className="inline-flex items-center">
                  View
                  <Help
                    label="View"
                    description="Opens the process page as it was at that version, read only. A button there takes you back to the live version."
                    example="View on v2 shows the map as it was before the last two publishes."
                  />
                </span>
                {actions && (
                  <>
                    <span className="ml-2 inline-flex items-center">
                      Restore
                      <Help
                        label="Restore"
                        description="Copies that version into your draft so you can edit it and publish it again. It does not touch the live version until you publish."
                        example="Restore v2 after a change made things worse, check it in the Editor, then publish it as v5."
                      />
                    </span>
                    <span className="ml-2 inline-flex items-center">
                      Duplicate
                      <Help
                        label="Duplicate"
                        description="Starts a new process from that version, leaving the original alone. The copy opens as a draft."
                        example="Duplicate v3 to keep how sales worked then, as its own process, while you keep changing the live one."
                      />
                    </span>
                  </>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const e = entries[v.revisionId];
              return (
                <tr key={v.revisionId} data-version={v.number} className="border-b align-top last:border-0">
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                    v{v.number}
                    {v.live && (
                      <Badge variant="outline" className="ml-2 border-accent bg-accent-soft font-sans text-fg">
                        Live
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{formatPublished(v.publishedAt)}</td>
                  <td className="px-3 py-2.5 text-xs">{authorLabel(v)}</td>
                  <td className="min-w-48 px-3 py-2.5">{describeChanges(v.changes, v.number === firstNumber)}</td>
                  <Numbers entry={e} queued={auto.includes(v.revisionId)} runnable={Boolean(loadModel) || v.revisionId in models} onRun={() => run(v.revisionId)} version={v.number} />
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!v.live && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`${viewBase}?version=${v.number}`}>View</Link>
                        </Button>
                      )}
                      {actions && !v.live && (
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "restore", version: v })}>
                          Restore
                        </Button>
                      )}
                      {actions && (
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "duplicate", version: v })}>
                          Duplicate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Simulated in your browser with {HISTORY_REPS} runs per version and the same random seed for each, so a difference between versions is the process changing, not luck.
        {versions.length > AUTO_RUN_VERSIONS ? ` The newest ${AUTO_RUN_VERSIONS} run on their own; press Run for an older one.` : ""}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      {actions && dialog?.kind === "restore" && (
        <RestoreDialog
          version={dialog.version.number}
          processName={processName}
          revisionId={dialog.version.revisionId}
          restore={actions.restore}
          links={links}
          onClose={() => setDialog(null)}
        />
      )}
      {actions && dialog?.kind === "duplicate" && (
        <DuplicateDialog
          version={dialog.version.number}
          processName={processName}
          revisionId={dialog.version.revisionId}
          duplicate={actions.duplicate}
          links={links}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** The two number cells of a version: its results, or why there aren't any. */
function Numbers({ entry, queued, runnable, onRun, version }: { entry: RunEntry | undefined; queued: boolean; runnable: boolean; onRun: () => void; version: number }) {
  if (entry?.status === "done") {
    const { winsPerMonth: w, leadToWinDays: d } = entry.headline;
    const days = (v: number) => formatNumber(v, v < 10 ? 1 : 0);
    return (
      <>
        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
          {formatNumber(w.mean, 1)}
          <span className="block text-xs text-muted-foreground">
            {formatNumber(w.lo, 1)}–{formatNumber(w.hi, 1)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
          {days(d.mean)} d
          <span className="block text-xs text-muted-foreground">
            {days(d.lo)}–{days(d.hi)}
          </span>
        </td>
      </>
    );
  }
  const text =
    entry?.status === "error" ? (
      <span className="text-xs text-muted-foreground" title={entry.message}>
        Can&apos;t run this version
      </span>
    ) : entry?.status === "running" || queued ? (
      <span className="text-xs text-muted-foreground" role="status">
        {entry?.status === "running" ? "Running…" : "Waiting…"}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Not run</span>
        {runnable && (
          <>
            <Button variant="outline" size="xs" onClick={onRun} aria-label={`Run version ${version}`}>
              Run
            </Button>
            <Help
              label="Run"
              description="Simulates this older version in your browser to fill in its numbers. Only the newest versions run on their own, to keep the page quick."
              example="Run on v2 takes a couple of seconds and adds its wins per month and lead to win to the charts."
            />
          </>
        )}
      </span>
    );
  return (
    <td colSpan={2} className="px-3 py-2.5 text-right">
      {text}
    </td>
  );
}
