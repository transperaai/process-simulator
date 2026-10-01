"use client";

// Insights v2 (issue #110, A45): the raw analysis from the latest run as rated rows, worst first, on the process page and
// the Overview alike. Hovering or focusing a row lights up the steps it touches on the page's map; clicking opens the
// detail. An insight only becomes an issue (and only then reaches the map) when someone acknowledges it (D24).

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import type { DetectedIssue } from "@transpera-flow/engine";
import type { IssueRow, ScenarioRow } from "@transpera-flow/db";
import { RATING_LABELS, type Rating } from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { RatingPill } from "@/components/overview/rating-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { entriesInProcess, formatIssueCost, registerEntries } from "@/lib/issues/register";
import { acknowledgeInsight, dismissInsight, type InsightContext } from "@/lib/insights/actions";
import { buildInsights, filterByRating, ratingCountsOf, type Insight } from "@/lib/insights/insights";
import type { IssuesState } from "@/lib/issues/use-issues";

/** The (i) texts: what each control does, in plain words, with an example. */
export const INSIGHT_HELP = {
  filter: {
    label: "Filter by rating",
    description: "Show only the insights with one rating. The number on each button is how many there are. Click it again, or All, to see everything.",
    example: "Click Operational risk 2 to see only the two that could break delivery or lose clients.",
  },
  row: {
    label: "Reading a row",
    description:
      "Each row is one thing the analysis noticed in the latest run: its rating, what it costs a month (an estimate), the number behind it, the steps it touches and what found it. Hover a row to see its steps on the map. Click it for the detail.",
    example: "“Strategist is too busy · Operational risk · about £4,200 a month · 94% busy · Audit & proposal · Too busy rule”.",
  },
  cost: {
    label: "Cost per month",
    description: "A rough price of this problem each month, worked out from the numbers in the run. It is an estimate, not a bill. It says n/a when the problem has no money price.",
    example: "About £4,200 a month (estimate): the strategist's overtime and the work that waits for them.",
  },
  number: {
    label: "The number",
    description: "The figure from the simulation that made the analysis raise this.",
    example: "The strategist is busy 94% of the time.",
  },
  worked: {
    label: "How it's worked out",
    description: "Which rule or AI found this, and where to change its limits. Changing a rule re-rates the run straight away.",
    example: "The Too busy rule rates 85% or more as Bad and 95% or more as Operational risk.",
  },
  sources: {
    label: "Linked sources",
    description: "Interviews, notes or documents that back this insight up, so others can trust it.",
    example: "Interview with Maya Collins: “I review every report before it goes out.”",
  },
  linkSource: {
    label: "Link a source",
    description: "Attach an interview, note or document to this insight. It comes with the Acknowledge dialog (A47), so it is switched off for now.",
    example: "Link Maya's interview to “Strategist is too busy”.",
  },
  dismiss: {
    label: "Dismiss",
    description: "Say this isn't a problem. It leaves the list and doesn't come back on later runs. It never reaches the map.",
    example: "Dismiss “Spare time” on a person who is meant to have slack.",
  },
  acknowledge: {
    label: "Acknowledge as issue",
    description: "Make this a tracked issue the team owns, with a rating, an owner and a status. Only then does it show on the map as a badge.",
    example: "Acknowledge “Strategist is too busy”: it becomes Issue #4 with a red badge on that step.",
  },
  issueLink: {
    label: "Issue number",
    description: "This insight has been acknowledged and is now a tracked issue. The link opens it in the register.",
    example: "Issue #4 is “Strategist is too busy”, owned by Maya.",
  },
} as const;

const RATING_STRIPE: Record<Rating, string> = { risk: "var(--rate-risk)", bad: "var(--rate-bad)", good: "var(--rate-good)", great: "var(--rate-great)" };

export interface InsightsProps {
  /** The insights to show, in order; null while the run is not in. */
  insights: Insight[] | null;
  currency: string;
  /** A step's name on this page's map. */
  stepName: (stepId: string) => string | null;
  /** The process a step belongs to, to name it on each row (the Overview). Omit on a process page. */
  processName?: (stepId: string) => string | null;
  /** The pointer or focus is on a row: its steps light up on the map; null when it leaves. */
  onLight: (stepIds: string[] | null) => void;
  /** "Settings → Analysis rules", where each rule's limits are changed. */
  rulesHref?: string;
  /** The issues register; an acknowledged insight links to its issue there. */
  registerHref?: string;
  /** Whether the viewer may acknowledge or dismiss. */
  canAct: boolean;
  onAcknowledge: (insight: Insight) => Promise<unknown>;
  onDismiss: (insight: Insight) => Promise<unknown>;
  /** The sources linked to an insight. Linking one comes with A47, so there are none to show yet. */
  linkedSources?: (insight: Insight) => { id: string; title: string }[];
  /** Show this many at first, with a button for the rest. */
  initialLimit?: number;
  busy?: boolean;
  error?: string | null;
  running?: boolean;
}

const issueHref = (registerHref: string | undefined, issue: IssueRow) => (registerHref ? `${registerHref}#issue-${issue.id}` : null);

export function Insights(props: InsightsProps) {
  const { insights, currency, stepName, processName, onLight, registerHref, initialLimit, error, running } = props;
  const [rating, setRating] = useState<Rating | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const counts = useMemo(() => ratingCountsOf(insights ?? []), [insights]);

  if (!insights) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (!insights.length) {
    return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing to report from the latest run. Every rule is within its limits.</p>;
  }

  const filtered = filterByRating(insights, rating);
  const shown = initialLimit && !all ? filtered.slice(0, initialLimit) : filtered;
  const opened = insights.find((i) => i.key === open) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-insights>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by rating">
        <Chip on={rating === ""} onClick={() => setRating("")} count={insights.length}>
          All
        </Chip>
        {counts.map((c) => (
          <Chip key={c.rating} on={rating === c.rating} disabled={c.count === 0} onClick={() => setRating(rating === c.rating ? "" : c.rating)} count={c.count} dot={c.rating}>
            {RATING_LABELS[c.rating]}
          </Chip>
        ))}
        <Help {...INSIGHT_HELP.filter} />
        <span className="ml-auto flex items-center text-xs text-muted-foreground" aria-live="polite">
          {running ? "Checking the latest run…" : `${filtered.length} insight${filtered.length === 1 ? "" : "s"}`}
          <Help {...INSIGHT_HELP.row} />
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-crit bg-crit-soft p-2 text-xs">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No insights have this rating.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((i) => {
            const names = i.stepIds.map((id) => stepName(id)).filter((n): n is string => !!n);
            const where = [names.join(", "), processName && i.stepIds[0] ? processName(i.stepIds[0]) : null].filter(Boolean).join(" · ");
            const link = i.issue ? issueHref(registerHref, i.issue) : null;
            const light = i.stepIds.length ? i.stepIds : null;
            return (
              <li
                key={i.key}
                data-insight={i.key}
                data-acknowledged={i.issue ? "" : undefined}
                onMouseEnter={() => onLight(light)}
                onMouseLeave={() => onLight(null)}
                onFocus={() => onLight(light)}
                onBlur={() => onLight(null)}
                className="group flex items-stretch gap-2 rounded-xl border bg-card shadow-token transition-colors focus-within:bg-muted/50 hover:bg-muted/50"
                style={{ borderLeft: `3px solid ${RATING_STRIPE[i.rating]}` }}
              >
                <button type="button" onClick={() => setOpen(i.key)} className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <b className="font-semibold">{i.title}</b>
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    <RatingPill rating={i.rating} />
                    <span className="tabular-nums" data-cost title={i.cost.method}>
                      {formatIssueCost(i.cost, currency)}
                    </span>
                    <span className="min-w-0">{i.number}</span>
                  </span>
                  {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
                </button>
                <span className="flex shrink-0 items-center gap-2 pr-3 text-xs text-muted-foreground">
                  <SourceTag insight={i} />
                  {i.issue &&
                    (link ? (
                      <Link href={link} className="rounded-md border px-2 py-0.5 font-medium text-foreground hover:bg-muted" data-issue-link>
                        Issue #{i.issueNumber} →
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">Issue #{i.issueNumber}</span>
                    ))}
                  <ChevronRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {initialLimit && filtered.length > initialLimit && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${filtered.length}`}
        </Button>
      )}

      <InsightDialog insight={opened} onClose={() => setOpen(null)} {...props} stepName={stepName} />
    </div>
  );
}

function Chip({ on, disabled, onClick, count, dot, children }: { on: boolean; disabled?: boolean; onClick: () => void; count: number; dot?: Rating; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${on ? "border-accent bg-accent-soft font-semibold" : "bg-card hover:bg-muted"}`}
    >
      {dot && <i aria-hidden className="size-2 rounded-full" style={{ background: `var(--rate-${dot})` }} />}
      {children}
      <b className="font-mono font-medium text-muted-foreground tabular-nums">{count}</b>
    </button>
  );
}

function SourceTag({ insight }: { insight: Insight }) {
  const ai = insight.source.kind === "ai";
  return (
    <span className="hidden items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 sm:inline-flex" data-source={ai ? "ai" : "rule"}>
      {ai && <Sparkles aria-hidden className="size-3 text-accent" />}
      {insight.source.name}
    </span>
  );
}

function InsightDialog({
  insight,
  onClose,
  stepName,
  currency,
  rulesHref,
  registerHref,
  canAct,
  onAcknowledge,
  onDismiss,
  linkedSources,
  busy,
}: InsightsProps & { insight: Insight | null; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const act = async (run: (i: Insight) => Promise<unknown>) => {
    if (!insight) return;
    setWorking(true);
    try {
      await run(insight);
      onClose();
    } finally {
      setWorking(false);
    }
  };
  const sources = insight ? (linkedSources?.(insight) ?? []) : [];
  const link = insight?.issue ? issueHref(registerHref, insight.issue) : null;
  const ai = insight?.source.kind === "ai";
  return (
    <Dialog open={!!insight} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl" data-insight-dialog>
        {insight && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <RatingPill rating={insight.rating} />
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                  {ai && <Sparkles aria-hidden className="size-3 text-accent" />}
                  {ai ? "AI analysis" : `Rule: ${insight.source.name}`}
                </span>
              </div>
              <DialogTitle>{insight.title}</DialogTitle>
              <DialogDescription>What the analysis found in the latest run.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="flex items-start text-xs font-medium text-muted-foreground uppercase">
                The number
                <Help {...INSIGHT_HELP.number} />
              </dt>
              <dd className="font-mono">{insight.number}</dd>
              <dt className="text-xs font-medium text-muted-foreground uppercase">What we found</dt>
              <dd>{insight.found}</dd>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Why it matters</dt>
              <dd>{insight.why}</dd>
              <dt className="text-xs font-medium text-muted-foreground uppercase">Touches</dt>
              <dd className="flex flex-wrap gap-1.5">
                {insight.stepIds.length ? (
                  insight.stepIds.map((id) => (
                    <span key={id} className="rounded-full border px-2 py-0.5 text-xs">
                      {stepName(id) ?? "A removed step"}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground">No step in particular</span>
                )}
              </dd>
              <dt className="flex items-start text-xs font-medium text-muted-foreground uppercase">
                Cost
                <Help {...INSIGHT_HELP.cost} />
              </dt>
              <dd data-cost>{formatIssueCost(insight.cost, currency)}</dd>
              <dt className="flex items-start text-xs font-medium text-muted-foreground uppercase">
                How it&apos;s worked out
                <Help {...INSIGHT_HELP.worked} />
              </dt>
              <dd className="text-muted-foreground">
                {ai ? (
                  "AI read this run's results, the process's first principles and linked sources, and wrote this. Every number comes from the simulation."
                ) : (
                  <>
                    The {insight.source.name} rule checked the results of 30 simulated runs against its limits.{" "}
                    {rulesHref && (
                      <Link href={rulesHref} className="text-foreground underline">
                        Settings → Analysis rules
                      </Link>
                    )}
                  </>
                )}
              </dd>
            </dl>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center text-xs font-medium text-muted-foreground uppercase">
                  Sources
                  <Help {...INSIGHT_HELP.sources} />
                </span>
                <span className="flex items-center">
                  <Button variant="ghost" size="sm" disabled title="Comes with A47">
                    + Link a source
                  </Button>
                  <Help {...INSIGHT_HELP.linkSource} />
                </span>
              </div>
              {sources.length ? (
                sources.map((s) => (
                  <p key={s.id} className="text-sm font-medium">
                    {s.title}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">None linked</p>
              )}
            </div>

            <DialogFooter className="items-center">
              {insight.issue ? (
                <span className="flex items-center">
                  {link ? (
                    <Button asChild>
                      <Link href={link}>Issue #{insight.issueNumber} →</Link>
                    </Button>
                  ) : (
                    <span className="text-sm font-medium">Issue #{insight.issueNumber}</span>
                  )}
                  <Help {...INSIGHT_HELP.issueLink} />
                </span>
              ) : canAct ? (
                <>
                  <span className="flex items-center">
                    <Button variant="outline" disabled={working || busy} onClick={() => act(onDismiss)}>
                      Dismiss
                    </Button>
                    <Help {...INSIGHT_HELP.dismiss} />
                  </span>
                  <span className="flex items-center">
                    <Button disabled={working || busy} onClick={() => act(onAcknowledge)}>
                      Acknowledge as issue…
                    </Button>
                    <Help {...INSIGHT_HELP.acknowledge} />
                  </span>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">You can read insights here; someone who can edit this workspace acknowledges them.</p>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The insights of one page from its issues state and this run's detections, with Dismiss and Acknowledge wired to the issue store. */
export function InsightsSection({
  state,
  detected,
  processId,
  stepIds,
  scenarios,
  currency,
  processOfStep,
  canEdit,
  ...rest
}: Omit<InsightsProps, "insights" | "onAcknowledge" | "onDismiss" | "busy" | "error" | "canAct"> & {
  state: IssuesState;
  /** This run's detections; null until the first run finishes. */
  detected: DetectedIssue[] | null;
  /** The process the detections came from. */
  processId: string;
  /** Keep to these steps (a process page's own and those inside it). Omit for the whole company (the Overview). */
  stepIds?: ReadonlySet<string>;
  scenarios: ScenarioRow[];
  processOfStep?: (stepId: string) => string | null | undefined;
  canEdit: boolean;
}) {
  const insights = useMemo(() => {
    if (detected === null) return null;
    const entries = registerEntries(state.issues, detected);
    return buildInsights(stepIds ? entriesInProcess(entries, processId, stepIds) : entries, state.issues);
  }, [detected, state.issues, stepIds, processId]);
  const ctx: InsightContext = { processId, processOfStep, scenarios };
  return (
    <Insights
      {...rest}
      insights={insights}
      currency={currency}
      canAct={canEdit}
      busy={state.busy}
      error={state.error}
      onAcknowledge={(i) => acknowledgeInsight(state, i, ctx)}
      onDismiss={(i) => dismissInsight(state, i, ctx)}
    />
  );
}

