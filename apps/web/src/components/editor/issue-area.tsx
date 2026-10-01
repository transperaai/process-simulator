"use client";

// The Editor's "Issue area" panel in solution mode (issue #114, A49): the steps of the issue being solved, which the map
// outlines in red with their groups open, and the issue's target, which the automatic verdict is checked against.

import type { StepRow } from "@transpera-flow/db";
import { Help } from "@/components/help";
import type { SolutionIssue } from "@/lib/solutions/area";

export function IssueArea({
  issue,
  steps,
  onSelect,
}: {
  issue: SolutionIssue | null;
  steps: readonly Pick<StepRow, "id" | "name">[];
  /** Select a step on the map. */
  onSelect: (stepId: string) => void;
}) {
  const names = new Map(steps.map((s) => [s.id, s.name]));
  return (
    <div className="flex flex-col gap-2" data-testid="issue-area">
      <span className="flex items-center text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
        Issue area
        <Help
          label="Issue area"
          description="The steps of the issue this solution is for, outlined in red on the map. Click one to select it. The solution is tested against the issue's target."
          example="Issue: “Website leads wait too long”. The area is Check fit and Enrich lead, and the target is first contact under 4 hours."
        />
      </span>
      {!issue ? (
        <p className="text-xs text-muted-foreground">Not linked to an issue yet. Save it, then link it to the issues it solves.</p>
      ) : (
        <>
          <p className="text-xs font-semibold">
            {issue.number == null ? "" : `#${issue.number} · `}
            {issue.title}
          </p>
          {issue.whole ? (
            <p className="text-xs text-muted-foreground">This issue is about the whole process, so no steps are outlined.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {issue.stepIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="rounded-full border border-crit px-2 py-0.5 text-xs text-crit hover:bg-crit-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crit"
                    onClick={() => onSelect(id)}
                  >
                    {names.get(id) ?? "Step"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {issue.target.measure || issue.target.goal ? (
              <>
                Target: {issue.target.measure ?? "no measure"}
                {issue.target.now ? `, now ${issue.target.now}` : ""}
                {issue.target.goal ? `, goal ${issue.target.goal}` : ""}
              </>
            ) : (
              "This issue has no target, so there is nothing to check automatically."
            )}
          </p>
        </>
      )}
    </div>
  );
}
