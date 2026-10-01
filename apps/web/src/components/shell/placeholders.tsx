import { Lightbulb } from "lucide-react";
import { ComingSoon } from "./coming-soon";

// The sidebar pages that don't exist yet (issue #98). One component each, shared by a workspace and the demo.

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
