"use client";

// The Issues list (issue #113, A48; prototype: "Issues"): the problems people have confirmed, with Open / Resolved / All
// and rating filters (both kept in the URL), sorted by rating and then cost. A cost comes from the latest run of the live
// process, simulated here in a worker as on the process page; until it is back the issues are sorted without it.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ModelError, toEngineModel, type IssueRow, type ProcessBundle, type ScenarioRow, type SourceRow } from "@transpera-flow/db";
import { RATING_LABELS, detectBrokenScenarios, ratingOfStored, resolveMoney, type AnalysisSettings, type FirstPrinciples, type IssueCost, type Rating } from "@transpera-flow/engine";
import { AcknowledgeDialog } from "@/components/acknowledge-dialog";
import { Help } from "@/components/help";
import { RatingPill } from "@/components/overview/rating-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { emptyDraft, issueFormOptions, toSaveInput } from "@/lib/issues/draft";
import { DEFAULT_LIST_STATE, NO_SOLUTIONS, RATINGS_WORST_FIRST, SHOW_FILTERS, SHOW_LABELS, isOpenIssue, issueHref, listIssues, listQuery, ratingCounts, shortDate, showCounts, solutionSummaries, statusLabel, type ListState, type ShowFilter } from "@/lib/issues/pages";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { useIssues } from "@/lib/issues/use-issues";
import { useDetectedIssues } from "@/lib/issues/use-detected";
import { useSuccessMeasures } from "@/lib/first-principles/use-measures";
import { visibleFindings } from "@/lib/rules/edit";
import { useRatingSettings } from "@/lib/rules/use-rating-settings";
import { retiredSteps } from "@/lib/scenarios/broken";
import { useAbsenceTest } from "@/lib/sim/absence";
import { useSimulation } from "@/lib/sim/use-simulation";
import { cn } from "@/lib/utils";

export interface Named {
  id: string;
  name: string;
}

/** The (i) texts for the list's controls. */
export const LIST_HELP = {
  show: {
    label: "Open, Resolved and All",
    description: "Open shows issues still to deal with: Open and Testing solutions. Resolved shows the ones you resolved or decided not to fix. The number is how many each holds.",
    example: "Open 3 means three issues still need work. Resolved issues keep their full history.",
  },
  rating: {
    label: "Filter by rating",
    description: "Show only the issues with one rating. The number on each button is how many there are among the issues you are looking at. Click it again, or All, to see everything.",
    example: "Click Operational risk to see only the issues that could break delivery or lose clients.",
  },
  table: {
    label: "Reading the table",
    description: "Each row is one confirmed issue: its number and title, its rating, the steps it touches, who owns it, where it stands and how many solutions have been tested. The most serious come first, then the costliest.",
    example: "“#2 Only Maya can do Audit & proposal · Bad · Audit & proposal · Rosa · Testing solutions · 1 tested”.",
  },
  solutions: {
    label: "Solutions tested",
    description: "How many solutions have been built and tested against this issue, with a tick when one passed. “None yet” means nobody has tried a fix.",
    example: "“2 tested ✓” means two solutions were tried and one passed.",
  },
  newIssue: {
    label: "New issue",
    description: "Add a problem you found yourself, such as one from an interview. You say what is wrong, how bad it is, what it touches and who owns it.",
    example: "“Clients wait too long to hear back”, touching the whole Sales process.",
  },
} as const;

export function IssuesPage({
  bundle,
  issues,
  scenarios,
  processes,
  sources = [],
  mode,
  analysisRules,
  firstPrinciples,
  initial = DEFAULT_LIST_STATE,
  base,
  liveRevisions,
}: {
  bundle: ProcessBundle;
  /** The live version's first principles, whose success measures rule 11 (goals met) rates. */
  firstPrinciples?: FirstPrinciples | null;
  issues: IssueRow[];
  scenarios: ScenarioRow[];
  processes: Named[];
  /** The workspace's sources, which the Acknowledge dialog can link to an issue. */
  sources?: SourceRow[];
  mode: "live" | "demo" | "readonly";
  /** The workspace's analysis rules (Settings → Analysis rules); omitted means the defaults. On the demo, the ones edited in this tab. */
  analysisRules?: AnalysisSettings;
  /** The filters the URL asked for. */
  initial?: ListState;
  /** Where the workspace's pages live: `/w/<slug>` or `/demo`. An issue's page is `<base>/issues/<number>`. */
  base: string;
  liveRevisions?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const state = useIssues(bundle.workspace.id, issues, mode, liveRevisions ?? { [bundle.process.id]: bundle.revision.id });
  const [filters, setFilters] = useState<ListState>(initial);
  const [newOpen, setNewOpen] = useState(false);

  const setFilter = (next: ListState) => {
    setFilters(next);
    // The filters are in the URL, so a link or a reload shows the same list.
    router.replace(`${pathname}${listQuery(next)}`, { scroll: false });
  };

  const costs = useIssueCosts(bundle, scenarios, mode, analysisRules, firstPrinciples);
  const costOf = (i: IssueRow): IssueCost | null => (i.detected_key ? (costs.get(i.detected_key) ?? null) : null);

  const options = useMemo(
    () =>
      issueFormOptions({
        processes,
        steps: [...bundle.steps, ...(bundle.otherProcesses ?? []).flatMap((p) => p.steps)],
        people: bundle.people.filter((p) => p.active),
        sources,
      }),
    [processes, bundle, sources],
  );
  const stepNames = useMemo(() => new Map([...bundle.steps, ...(bundle.otherProcesses ?? []).flatMap((p) => p.steps)].map((s) => [s.id, s.name])), [bundle]);
  const processNames = useMemo(() => new Map(processes.map((p) => [p.id, p.name])), [processes]);
  const peopleNames = useMemo(() => new Map(bundle.people.map((p) => [p.id, p.name])), [bundle.people]);
  const summaries = useMemo(() => solutionSummaries(), []);

  const counts = showCounts(state.issues);
  const ratings = ratingCounts(state.issues, filters.show);
  const list = listIssues(state.issues, filters, costOf);
  const canEdit = mode !== "readonly";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-border bg-panel p-0.5">
            {SHOW_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                data-show={k}
                aria-pressed={filters.show === k}
                onClick={() => setFilter({ ...filters, show: k })}
                className={cn("rounded-md px-3 py-1 text-sm", filters.show === k ? "bg-accent font-medium text-accent-fg" : "text-fg-2 hover:bg-muted")}
              >
                {SHOW_LABELS[k]} <span className="tabular-nums">{counts[k]}</span>
              </button>
            ))}
          </div>
          <Help {...LIST_HELP.show} className="ml-0" />
          <RatingChips ratings={ratings} value={filters.rating} onChange={(rating) => setFilter({ ...filters, rating })} />
        </div>
        {canEdit && (
          <span className="flex items-center">
            <Button type="button" onClick={() => setNewOpen(true)}>
              + New issue
            </Button>
            <Help {...LIST_HELP.newIssue} />
          </span>
        )}
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      {list.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground" data-empty>
          No issues here. Acknowledge an insight, or add one by hand.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left text-sm" data-issues-table>
            <thead>
              <tr className="border-b border-border text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                <th className="px-4 py-2.5">
                  <span className="inline-flex items-center">
                    Issue
                    <Help {...LIST_HELP.table} />
                  </span>
                </th>
                <th className="px-3 py-2.5">Rating</th>
                <th className="px-3 py-2.5">Touches</th>
                <th className="px-3 py-2.5">Owners</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">
                  <span className="inline-flex items-center">
                    Solutions
                    <Help {...LIST_HELP.solutions} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const touched = i.links.length
                  ? i.links.map((l) => (l.step_id ? (stepNames.get(l.step_id) ?? "A step") : `Whole process: ${processNames.get(l.process_id ?? "") ?? "process"}`))
                  : [];
                const owners = (i.owner_ids.length ? i.owner_ids : i.owner_person_id ? [i.owner_person_id] : []).map((id) => peopleNames.get(id) ?? "Someone");
                const sol = summaries[i.id] ?? NO_SOLUTIONS;
                const href = issueHref(base, i);
                return (
                  <tr
                    key={i.id}
                    data-issue-row={i.number ?? i.id}
                    className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted/50", !isOpenIssue(i) && "opacity-70")}
                    onClick={() => router.push(href)}
                  >
                    <td className="px-4 py-2.5">
                      <Link href={href} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i.number ? `#${i.number}` : ""}</span>
                        {i.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <RatingPillOf issue={i} />
                    </td>
                    <td className="max-w-56 px-3 py-2.5 text-xs text-fg-2">{touched.join(", ") || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{owners.join(", ") || <span className="text-muted-foreground">No owner</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusChip issue={i} />
                      {i.resolved_at && !isOpenIssue(i) && <div className="text-xs text-muted-foreground">{shortDate(i.resolved_at)}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" data-solutions>
                      {sol.tested ? (
                        <span>
                          {sol.tested} tested{sol.passed ? <span className="ml-1 text-good">✓ passed</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{sol.ideas ? "" : "—"}</span>
                      )}
                      {sol.ideas ? <div className="text-muted-foreground">{sol.ideas} AI idea{sol.ideas === 1 ? "" : "s"}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <AcknowledgeDialog
        open={newOpen}
        mode="new"
        draft={emptyDraft(bundle.process.id)}
        options={options}
        busy={state.busy}
        error={state.error}
        onClose={() => setNewOpen(false)}
        onSubmit={(draft) => state.save(toSaveInput(draft, options))}
      />
    </div>
  );
}

export function RatingPillOf({ issue }: { issue: Pick<IssueRow, "severity"> }) {
  return <RatingPill rating={ratingOf(issue)} />;
}

const ratingOf = (i: Pick<IssueRow, "severity">): Rating => ratingOfStored(i.severity);

/** The status as a small chip: open ones in the accent, closed ones quiet. */
export function StatusChip({ issue }: { issue: Pick<IssueRow, "status"> }) {
  return (
    <span
      data-status={issue.status}
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        isOpenIssue(issue) ? "border-accent/40 bg-accent/10 text-fg" : "border-border bg-muted text-fg-2",
      )}
    >
      {statusLabel(issue.status)}
    </span>
  );
}

function RatingChips({ ratings, value, onChange }: { ratings: ReturnType<typeof ratingCounts>; value: Rating | ""; onChange: (r: Rating | "") => void }) {
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs disabled:opacity-40";
  return (
    <div role="group" aria-label="Filter by rating" className="flex flex-wrap items-center gap-1.5">
      <button type="button" data-rating="" aria-pressed={!value} onClick={() => onChange("")} className={cn(chip, !value ? "border-accent bg-accent/10 font-medium" : "border-border")}>
        All <b className="tabular-nums">{ratings.all}</b>
      </button>
      {RATINGS_WORST_FIRST.map((r) => (
        <button
          key={r}
          type="button"
          data-rating={r}
          aria-pressed={value === r}
          disabled={!ratings.byRating[r] && value !== r}
          onClick={() => onChange(value === r ? "" : r)}
          className={cn(chip, value === r ? "border-accent bg-accent/10 font-medium" : "border-border")}
        >
          <i aria-hidden className="size-2 rounded-full" style={{ background: `var(--rate-${r})` }} />
          {RATING_LABELS[r]} <b className="tabular-nums">{ratings.byRating[r]}</b>
        </button>
      ))}
      <Help {...LIST_HELP.rating} />
    </div>
  );
}

/**
 * What the latest run of the live process says each issue costs a month, by detection key: the list sorts by rating and
 * then by this. The run is simulated in a worker; until it is back the map is empty and nothing is costed.
 */
function useIssueCosts(
  bundle: ProcessBundle,
  scenarios: ScenarioRow[],
  mode: "live" | "demo" | "readonly",
  analysisRules: AnalysisSettings | undefined,
  firstPrinciples: FirstPrinciples | null | undefined,
): Map<string, IssueCost> {
  const model = useMemo(() => {
    try {
      return toEngineModel(bundle);
    } catch (err) {
      if (err instanceof ModelError) return null;
      throw err;
    }
  }, [bundle]);
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;
  const broken = useMemo(() => (model ? detectBrokenScenarios(model, scenarios, retiredSteps(bundle)) : []), [model, scenarios, bundle]);
  const gaps = useMemo(() => perceptionGapDetections(bundle.steps), [bundle.steps]);
  const rules = useRatingSettings(mode === "demo", analysisRules);
  const absence = useAbsenceTest(model && result && sim.status === "done" ? model : null, result?.seed ?? 1, resolveMoney(rules).absenceWeeks);
  const successMeasures = useSuccessMeasures(bundle.process.id, mode === "demo", firstPrinciples);
  const found = useDetectedIssues(model, result, rules, bundle.process.id, bundle.workspace.settings.currency, absence, successMeasures);
  return useMemo(() => {
    const detected = visibleFindings(rules, found ? [...broken, ...found, ...gaps] : gaps);
    return new Map(detected.map((d) => [d.key, d.cost as IssueCost]));
  }, [found, broken, gaps, rules]);
}
