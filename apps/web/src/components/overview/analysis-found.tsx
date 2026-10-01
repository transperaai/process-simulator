"use client";

// "What the analysis found" (issue #100, A35): a count per rating, the AI read, and the findings.

import { Sparkles } from "lucide-react";
import { RATING_LABELS, type DetectedIssue, type Rating } from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ratingCounts } from "@/lib/overview/findings";

/** The findings can't be Great (a Great result isn't a problem), so the counts are of the other three. */
const COUNTED: readonly Rating[] = ["risk", "bad", "good"];

export function RatingCounts({ findings }: { findings: readonly Pick<DetectedIssue, "rating">[] | null }) {
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
