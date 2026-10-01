import Link from "next/link";
import { ChevronRight, LayoutDashboard, Lightbulb, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ComingSoon } from "./coming-soon";
import { Page } from "./page";

// The sidebar pages that don't exist yet (issue #98). One component each, shared by a workspace and the demo.

export function OverviewSoon({ mapHref }: { mapHref: string }) {
  return (
    <ComingSoon
      title="Overview"
      ticket="A35"
      icon={LayoutDashboard}
      description="Where the whole company stands, at a glance."
      willHave={["A map of the company and its processes", "Four headline numbers, over 1, 3, 6, 12 or 24 months", "What the analysis found, in plain words, then the trends"]}
      meanwhile={{ label: "Open the process map", href: mapHref }}
    />
  );
}

export function SolutionsSoon({ issuesHref }: { issuesHref: string }) {
  return (
    <ComingSoon
      title="Solutions"
      eyebrow="Improve"
      ticket="A49"
      icon={Lightbulb}
      description="Changes you have built and tested against an issue. They never change the live map."
      willHave={["Every solution, and which issues it solves", "How each one did against each issue's target", "Live and solution maps side by side"]}
      meanwhile={{ label: "See the issues", href: issuesHref }}
    />
  );
}

export interface ProcessLink {
  id: string;
  name: string;
  /** "pipeline" or "servicing" in the data; shown as a plain word. */
  kind: string;
  href: string;
}

/** Every process of the workspace, each opening its map. Processes inside processes and per-process cards come with A36. */
export function ProcessesList({ processes }: { processes: ProcessLink[] }) {
  return (
    <Page
      title="Processes"
      description="Every process in this company. Open one to see its map, run the simulation and move the levers."
    >
      <Card className="gap-0 py-0">
        {processes.length === 0 && <p className="p-4 text-sm text-muted-foreground">No processes yet.</p>}
        <ul className="divide-y">
          {processes.map((p) => (
            <li key={p.id}>
              <Link href={p.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <Workflow aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <Badge variant="outline">{p.kind === "servicing" ? "Client work" : "Sales pipeline"}</Badge>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted-foreground">Processes inside processes, and a card for each one, come in A36.</p>
    </Page>
  );
}
