"use client";

// The process page's Solutions section (issue #114, A49): a simple list of this process's solutions, each with the issues it
// solves and how it did against them, and the ways into the Editor's solution mode ("New solution", and "Build solution"
// on an issue). A50 builds the full solution page later.

import { useMemo } from "react";
import Link from "next/link";
import type { IssueRow, SolutionIssueRow, SolutionRow } from "@transpera-flow/db";
import { Help } from "@/components/help";
import { useDemoSolutions } from "@/lib/solutions/demo";
import { buildSolutionHref, newSolutionHref } from "@/lib/solutions/links";

export interface SolutionsData {
  solutions: SolutionRow[];
  links: SolutionIssueRow[];
}

const verdictLabel = (v: "pass" | "fail" | null) => (v === "pass" ? "Pass" : v === "fail" ? "Fail" : "Not checked");
const verdictTone = (v: "pass" | "fail" | null) => (v === "pass" ? "text-good" : v === "fail" ? "text-crit" : "text-muted-foreground");
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function ProcessSolutions({
  processId,
  base,
  demo,
  canEdit,
  data,
  issues,
}: {
  processId: string;
  /** `/w/<slug>` or `/demo`: where the Editor lives. */
  base: string;
  demo: boolean;
  /** Who can build a solution: owners and editors. */
  canEdit: boolean;
  /** This process's solutions and their links, as loaded with the page (the demo keeps its own). */
  data: SolutionsData;
  /** The workspace's issues, for names and for the issues that can have a solution built. */
  issues: IssueRow[];
}) {
  const inTab = useDemoSolutions();
  const solutions = demo ? inTab.solutions.filter((s) => s.process_id === processId) : data.solutions.filter((s) => s.process_id === processId);
  const links = demo ? inTab.links : data.links;
  const issueById = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const from = `${base}/p/${processId}#solutions`;
  const toSolve = issues.filter(
    (i) => (i.status === "open" || i.status === "testing") && (i.process_id === processId || i.links.some((l) => l.process_id === processId)),
  );

  return (
    <div className="flex flex-col gap-3" data-testid="process-solutions">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Link
            href={newSolutionHref(base, processId, from)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-edit px-3 text-sm font-medium text-edit-fg hover:opacity-90"
          >
            ✎ New solution
          </Link>
          <Help
            label="New solution"
            description="Opens the Editor on a copy of this process. Change the steps, simulate, and save it as a solution. The live map and its draft don't change, and you can link the solution to issues afterwards."
            example="Try an AI lead check before the sales call, save it as “AI lead qualifier”, and compare it with live."
          />
        </div>
      )}
      {solutions.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-4 text-sm text-fg-2" data-testid="solutions-empty">
          No solutions yet. Build one from an issue, or start one here.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Solutions">
          {solutions.map((s) => {
            const mine = links.filter((l) => l.solution_id === s.id);
            return (
              <li key={s.id} className="flex flex-col gap-2 rounded-token border border-line bg-panel p-3" data-testid="solution-card">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <b className="text-sm">{s.name}</b>
                  <span className="text-xs text-muted-foreground">{date(s.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.changed_step_ids.length} {s.changed_step_ids.length === 1 ? "step" : "steps"} changed
                  {s.lever_changes.length ? `, ${s.lever_changes.length} lever ${s.lever_changes.length === 1 ? "change" : "changes"}` : ""}
                </p>
                {mine.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Not linked to an issue yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {mine.map((l) => {
                      const issue = issueById.get(l.issue_id);
                      return (
                        <li key={l.issue_id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-semibold">{issue?.number == null ? "Issue" : `#${issue.number}`}</span>
                          <span className="min-w-0 flex-1 truncate text-fg-2">{issue?.title ?? "An issue"}</span>
                          <span className={`font-semibold ${verdictTone(l.auto_verdict)}`}>
                            {verdictLabel(l.auto_verdict)}
                            {l.holds_pct !== null ? `, holds in ${l.holds_pct}%` : ""}
                          </span>
                          {l.user_verdict && <span className={`font-semibold ${verdictTone(l.user_verdict)}`}>Yours: {verdictLabel(l.user_verdict)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && toSolve.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="build-from-issue">
          <span className="flex items-center text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
            Build from an issue
            <Help
              label="Build solution"
              description="Opens the Editor on a copy of this process with the issue's steps outlined in red. When you save, the solution is tested against the issue's target and the issue moves to Testing solutions."
              example="Issue “Website leads wait too long”: Build solution outlines Check fit and Enrich lead, and checks first contact against under 4 hours."
            />
          </span>
          <ul className="flex flex-col gap-1">
            {toSolve.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="text-xs font-semibold">{i.number == null ? "Issue" : `#${i.number}`}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <Link href={buildSolutionHref(base, i, from) ?? newSolutionHref(base, processId, from)} className="text-xs font-semibold text-edit hover:underline">
                  ✎ Build solution
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
