import { Help } from "@/components/help";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HeadlineCard } from "@/lib/overview/headline";
import { cn } from "@/lib/utils";

/** The four numbers at the top of the Overview, each an average with the range of 30 runs under it. */
export function HeadlineCards({ cards }: { cards: HeadlineCard[] | null }) {
  const labels = ["New clients won", "Monthly recurring revenue", "Clients lost to churn", "Bottleneck"];
  return (
    <section aria-label="Headline numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards
        ? cards.map((c) => (
            <Card key={c.key} className="gap-1 px-4 py-3.5 shadow-token" data-card={c.key}>
              <p className="flex flex-wrap items-center text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                <span>{c.label}</span>
                <Help label={c.label} description={c.help.description} example={c.help.example} />
              </p>
              <p
                className={cn(
                  "truncate font-heading text-2xl font-semibold tracking-tight tabular-nums",
                  c.tone === "crit" && "text-crit",
                  c.tone === "warn" && "text-warn",
                )}
                title={c.value}
              >
                {c.value}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">{c.range}</p>
              {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
            </Card>
          ))
        : labels.map((l) => (
            <Card key={l} className="gap-2 px-4 py-3.5" aria-busy="true">
              <p className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">{l}</p>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3.5 w-32" />
            </Card>
          ))}
    </section>
  );
}
