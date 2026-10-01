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
import { AUTO_RUN_VERSIONS, HISTORY_REPS, MEASURES, authorLabel, autoRunIds, describeChanges, formatPublished, versionLabel, type Headline, type Measure, type MeasureInfo, type ProcessKind, type RunEntry, type VersionMeta } from "@/lib/history/versions";

/**
 * The History screen's body (issue #105): two charts of the headline measures by version, then the table of
 * published versions. The newest versions are simulated here in the browser as soon as the page opens; older
 * ones say "Not run" until someone presses Run. Editors also get Restore and Duplicate.
 */
export function HistoryView({
  processName,
  kind,
  versions,
  models,
  loadModel,
  viewBase,
  actions,
  links,
  note,
}: {
  processName: string;
  /** A sales pipeline or a servicing process: they are measured differently. */
  kind: ProcessKind;
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
  const { entries, run } = useVersionRuns({ models, auto, weeks, kind, loadModel });
  const [dialog, setDialog] = useState<{ kind: "restore" | "duplicate"; version: VersionMeta } | null>(null);

  const ownWeeks = Object.values(models).flatMap((m) => ("model" in m ? [m.model.horizonWeeks] : []))[0] ?? 13;
  const oldestFirst = [...versions].sort((a, b) => a.number - b.number);
  const firstNumber = oldestFirst[0]?.number;
  const measureOf = (v: VersionMeta, key: keyof Headline): Measure | null => {
    const e = entries[v.revisionId];
    return e?.status === "done" ? e.headline[key] : null;
  };
  const [infoA, infoB] = MEASURES[kind];
  const servicing = kind === "servicing";
  const format = (v: number) => formatNumber(v, servicing ? 0 : v < 10 ? 1 : 0);
  const formatA = (v: number) => (servicing ? format(v) : formatNumber(v, 1));
  const everyRunFinished = auto.every((id) => entries[id]?.status === "done" || entries[id]?.status === "error");
  const nothingToMeasure = everyRunFinished && oldestFirst.every((v) => measureOf(v, "a") === null);
  const pending = auto.filter((id) => entries[id]?.status !== "done" && entries[id]?.status !== "error").length;

  if (versions.length === 0) {
    return (
      <p className="rounded-token border border-dashed border-line p-6 text-sm text-muted-foreground">
        {processName} hasn&apos;t been published yet, so it has no history. Publish its first version from the Editor.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Every published version, with its simulated results. {actions ? "Restore one, or duplicate it as a new process." : "Open one to see how it looked."}
        </p>
        <HorizonPicker weeks={weeks ?? ownWeeks} onChange={setMonths} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {([["a", infoA], ...(servicing ? [] : [["b", infoB] as const])] as const).map(([key, info]) => (
          <HistoryChart
            key={key}
            title={info.title}
            help={<Help label={info.column} description={info.help.description} example={info.help.example} />}
            unit={info.unit}
            format={key === "a" ? formatA : format}
            pending={pending}
            fixedMax={servicing ? 100 : undefined}
            empty={nothingToMeasure && servicing ? "No numbers: this needs clients entered in your settings, so there are touchpoints to measure." : undefined}
            data={oldestFirst.map((v) => ({ label: versionLabel(v.number), measure: measureOf(v, key) }))}
          />
        ))}
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
              {[infoA, infoB].map((info) => (
                <th key={info.column} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {info.column}
                  <Help label={`${info.column} in the table`} description={`${info.help.description} The smaller figure under each number is its range.`} example={info.help.example} />
                </th>
              ))}
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
                  <Numbers entry={e} infos={[infoA, infoB]} queued={auto.includes(v.revisionId)} runnable={Boolean(loadModel) || v.revisionId in models} onRun={() => run(v.revisionId)} version={v.number} />
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
        Simulated in your browser with {HISTORY_REPS} runs per version and the same random seed for each, so a difference between versions is the process changing, not luck. Every version is simulated with today&apos;s roles, people and settings, not the ones it was published with.
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
function Numbers({ entry, infos, queued, runnable, onRun, version }: { entry: RunEntry | undefined; infos: [MeasureInfo, MeasureInfo]; queued: boolean; runnable: boolean; onRun: () => void; version: number }) {
  if (entry?.status === "done") {
    const cell = (m: Measure | null, info: MeasureInfo) => {
      if (!m) return <td className="px-3 py-2.5 text-right text-muted-foreground">–</td>;
      const digits = (v: number) => formatNumber(v, info.suffix === "%" ? 0 : v < 10 || info.suffix === "" ? 1 : 0);
      return (
        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
          {digits(m.mean)}
          {info.suffix}
          <span className="block text-xs text-muted-foreground">
            {digits(m.lo)}–{digits(m.hi)}
          </span>
        </td>
      );
    };
    return (
      <>
        {cell(entry.headline.a, infos[0])}
        {cell(entry.headline.b, infos[1])}
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
