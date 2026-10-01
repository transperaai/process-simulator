import { LayoutDashboard, Lightbulb } from "lucide-react";
import { ComingSoon } from "./coming-soon";

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
