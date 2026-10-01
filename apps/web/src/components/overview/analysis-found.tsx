"use client";

// "What the analysis found" (issue #100, A35): a count per rating, the AI read, and the five worst findings.

import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { RATING_LABELS, RATING_RULES, type DetectedIssue, type Rating } from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ruleOfIssue } from "@/lib/rules/edit";
import { costPerMonth, ratingCounts } from "@/lib/overview/findings";
import { formatWholeCurrency } from "@/lib/format";
import { RatingPill } from "./rating-pill";

/** Where a finding sits: the step it is on and the process that step belongs to. */
export interface FindingPlace {
  step: string;
  process: string;
  href: string;
}

/** The findings can't be Great (a Great result isn't a problem), so the counts are of the other three. */
const COUNTED: readonly Rating[] = ["risk", "bad", "good"];

/** The first sentence of a finding's evidence, which carries its main number. */
function headline(evidence: string): string {
  const end = evidence.search(/[.!?](\s|$)/);
  return end === -1 ? evidence : evidence.slice(0, end + 1);
}

export function RatingCounts({ findings }: { findings: readonly DetectedIssue[] | null }) {
  if (!findings) return <Skeleton className="h-5 w-72 max-w-full" />;
  const counts = ratingCounts(findings).filter((c) => COUNTED.includes(c.rating));
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {counts.map((c, i) => (
        <span key={c.rating} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <i aria-hidden className="size-2 rounded-full" style={{ background: `var(--rate-${c.rating})` }} />
          <b className="font-semibold text-foreground tabular-nums">{c.count}</b> {RATING_LABELS[c.rating].toLowerCase()}
        </span>
      ))}
      <Help
        label="Ratings"
        description="Every finding gets one of four ratings, worst first: Operational risk (could break delivery or lose clients, fix now), Bad, not urgent (costing time or money, plan a fix), Good, could improve (fine today, with something to gain) and Great (working well). Findings are only listed when there is something to do, so Great never appears here."
        example="“Too busy” on the strategist at 82% is Bad, not urgent; at 97% it is Operational risk."
      />
    </p>
  );
}

/**
 * Where the AI's summary of the run will go. Nothing is written here: the summary needs the AI writer (A46), and
 * an invented one would look like a result.
 */
export function AiReadPlaceholder() {
  return (
    <div data-placeholder="ai-read" className="flex flex-col gap-1.5 rounded-xl border border-dashed bg-card/50 p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden className="size-4 text-accent" />
        AI read of this run
        <Badge variant="outline">Not switched on yet</Badge>
        <Help
          label="AI read"
          description="A short plain-English summary of the run, written by AI after it reads the results, the company's first principles and your sources. Every number it uses comes from the simulation, never from the AI."
          example="“The strategist is the bottleneck: audits wait about a day before anyone starts them.”"
        />
      </p>
      <p className="text-sm text-muted-foreground">
        The summary will appear here once the AI writer is switched on. Until then, the findings below come straight from the analysis rules.
      </p>
    </div>
  );
}

export function FindingRows({
  findings,
  places,
  total,
  currency,
  onLight,
}: {
  /** The five to show, worst first; null while the run is not in. */
  findings: readonly DetectedIssue[] | null;
  places: (finding: DetectedIssue) => FindingPlace | null;
  /** How many findings there are in all. */
  total: number;
  currency: string;
  /** The pointer or keyboard focus is on a finding: its steps light up on the map. */
  onLight: (stepIds: string[] | null) => void;
}) {
  if (!findings) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (!findings.length) {
    return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing to report from the latest run. Every rule is within its limits.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f) => {
        const place = places(f);
        const rule = ruleOfIssue(f);
        const cost = costPerMonth(f);
        const lit = f.stepId ? [f.stepId] : null;
        return (
          <li key={f.key}>
            <Link
              href={place?.href ?? "#"}
              onPointerEnter={() => onLight(lit)}
              onPointerLeave={() => onLight(null)}
              onFocus={() => onLight(lit)}
              onBlur={() => onLight(null)}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm shadow-token transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
              style={{ borderLeft: `3px solid var(--rate-${f.rating})` }}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <b className="font-semibold">{f.title}</b>
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <RatingPill rating={f.rating} />
                  {cost !== null && cost > 0 && <span title="Estimated cost each month" className="tabular-nums">about {formatWholeCurrency(cost, currency)} a month</span>}
                  <span className="min-w-0">{headline(f.evidence)}</span>
                </span>
                {place && (
                  <span className="truncate text-xs text-muted-foreground">
                    {place.step}
                    {place.process !== place.step && ` · ${place.process}`}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {rule && <span className="hidden rounded-md bg-muted px-1.5 py-0.5 sm:inline">{RATING_RULES[rule].name}</span>}
                <ChevronRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        );
      })}
      {total > findings.length && <li className="px-1 text-xs text-muted-foreground">Showing the {findings.length} that matter most, of {total}.</li>}
    </ul>
  );
}
