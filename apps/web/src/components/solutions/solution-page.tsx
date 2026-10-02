"use client";

// The Solution page (issue #115, A50 slice 1; prototype: route "compare"): the header, the issues the solution solves with an
// automatic verdict each and your own pass or fail, "+ Link an issue", and notes. The two maps side by side, the measures, the MRR
// chart and the market stress test are slice 2: their places are marked below and nothing is drawn in them yet.
// Your verdict and notes are saved on the solution's links and logged on each issue's history by the database.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IssueRow, SolutionIssueRow, SolutionRow, SolutionVerdict } from "@transpera-flow/db";
import { StatusChip } from "@/components/issues-page";
import { Help, HelpLabel } from "@/components/help";
import { VerdictWord } from "@/components/solutions/solution-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { issueHref } from "@/lib/issues/pages";
import { saveSolutionNotes, saveSolutionVerdict } from "@/app/w/[slug]/solution-page-actions";
import { linkSolutionToIssue } from "@/app/w/[slug]/solution-actions";
import { builtBy, builtDate, changesLine, linkableIssues, linksOf, MAX_NOTES, solutionType, solutionsListHref, type SolutionsData } from "@/lib/solutions/cards";
import { addDemoLink, setDemoNotes, setDemoVerdict, useDemoSolutions } from "@/lib/solutions/demo";
import { demoLinkVerdict } from "@/lib/solutions/demo-link";
import { SOLUTION_PAGE_HELP } from "@/lib/solutions/help";
import { solutionEditorHref } from "@/lib/solutions/links";
import { cn } from "@/lib/utils";

const CARD_TITLE = "font-heading text-lg leading-snug font-semibold tracking-tight";
const EYEBROW = "flex items-center text-2xs font-semibold tracking-wider text-muted-foreground uppercase";

export interface SolutionPageProps {
  workspaceId: string;
  solutionId: string;
  /** As loaded with the page; the demo ignores it and reads what this tab has saved. */
  data?: SolutionsData;
  issues: IssueRow[];
  processes: { id: string; name: string }[];
  /** `/w/<slug>` or `/demo`. */
  base: string;
  mode: "live" | "demo" | "readonly";
  viewerId?: string | null;
}

export function SolutionPage(props: SolutionPageProps) {
  const { workspaceId, solutionId, issues, processes, base, mode, viewerId } = props;
  const router = useRouter();
  const inTab = useDemoSolutions();
  // A workspace's data comes with the page; this copy follows what was saved here, and follows the page when it is reloaded.
  const [local, setLocal] = useState<SolutionsData>(props.data ?? { solutions: [], links: [] });
  const [seen, setSeen] = useState(props.data);
  if (seen !== props.data) {
    setSeen(props.data);
    setLocal(props.data ?? { solutions: [], links: [] });
  }
  const data = mode === "demo" ? inTab : local;
  const solution = data.solutions.find((s) => s.id === solutionId);
  const canEdit = mode !== "readonly";
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  if (!solution) {
    return (
      <div className="flex flex-col gap-3" data-solution-missing>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Solution not found</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "demo" ? "Demo solutions only live in the tab that saved them, and are gone when you reload." : "It may have been deleted."}
        </p>
        <Link href={solutionsListHref(base)} className="text-sm font-medium text-accent hover:underline">
          ← All solutions
        </Link>
      </div>
    );
  }

  const links = linksOf(data, solution.id);
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const processName = processes.find((p) => p.id === solution.process_id)?.name ?? "a process";
  const type = solutionType(solution);
  const toLink = linkableIssues(issues, solution.process_id, new Set(links.map((l) => l.issue_id)));

  const putLink = (link: SolutionIssueRow) =>
    setLocal((d) => ({ ...d, links: d.links.some((l) => l.solution_id === link.solution_id && l.issue_id === link.issue_id) ? d.links.map((l) => (l.solution_id === link.solution_id && l.issue_id === link.issue_id ? link : l)) : [...d.links, link] }));

  const saveVerdict = async (link: SolutionIssueRow, verdict: SolutionVerdict | null, notes?: string) => {
    setError(null);
    if (mode === "demo") return void setDemoVerdict(solution.id, link.issue_id, verdict, notes);
    const r = await saveSolutionVerdict(workspaceId, solution.id, link.issue_id, verdict, notes);
    if (r.status === "error") return setError(r.message);
    putLink(r.link);
  };

  return (
    <div className="flex flex-col gap-6" data-solution-page={solution.id}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 max-w-prose flex-col gap-1.5">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Link href={solutionsListHref(base)} className="hover:underline">
              Solutions
            </Link>
            <span aria-hidden>/</span>
            <span className="min-w-0 break-words">{solution.name}</span>
          </nav>
          <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight break-words">{solution.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              data-solution-type={type}
              className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs font-semibold", type === "AI block" ? "border-accent/50 bg-accent/10" : "border-border bg-muted")}
            >
              {type}
            </span>
            <span className="flex items-center text-sm text-muted-foreground" data-built>
              Built by {builtBy(solution.created_by, viewerId, mode === "demo")} · {builtDate(solution)} · changes {processName}
              <Help {...SOLUTION_PAGE_HELP.built} />
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Changes: {changesLine(solution, 6)}</span>
        </div>
        {canEdit && (
          <span className="flex items-center">
            <Link
              href={solutionEditorHref(base, solution.process_id, { from: `${base}/solutions/${solution.id}` })}
              className="inline-flex h-9 items-center rounded-md bg-edit px-3 text-sm font-medium text-edit-fg hover:opacity-90"
              data-open-editor
            >
              ✎ Open in Editor
            </Link>
            <Help label="Open in Editor" description="Opens the Editor in solution mode on this solution's process, to build a variation. Saving there makes a new solution; this one stays exactly as it is. Nothing you do there changes the live map." example="Start from the same process and try keeping the manual check for large leads." />
          </span>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2" data-section="solves">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 className={`${CARD_TITLE} flex items-center`}>
              Solves
              <Help {...SOLUTION_PAGE_HELP.solves} />
            </h2>
            <p className="text-sm text-muted-foreground">A solution can solve more than one issue. Each is judged against its own target.</p>
          </div>
          {canEdit && (
            <span className="flex items-center">
              <Button type="button" size="sm" variant="outline" onClick={() => setLinking(true)} data-link-issue>
                + Link an issue
              </Button>
              <Help {...SOLUTION_PAGE_HELP.link} />
            </span>
          )}
        </div>
        {links.length === 0 ? (
          <Card className="px-4 py-6 text-sm text-muted-foreground" data-empty="solves">
            Not linked to an issue yet.{canEdit ? " Use + Link an issue to test it against one." : ""}
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {links.map((l) => (
              <SolvesCard
                key={l.issue_id}
                link={l}
                issue={issueById.get(l.issue_id)}
                base={base}
                canEdit={canEdit}
                onVerdict={(v) => saveVerdict(l, v)}
                onNote={(notes) => saveVerdict(l, l.user_verdict, notes)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Slice 2 (issue #115 continues): the places for what comes next. Nothing is drawn in them yet. */}
      <Slice2 id="compare" title="Live vs this solution" help={SOLUTION_PAGE_HELP.compare} text="The live map and this solution's map side by side, opening and closing together, with new or changed steps marked." />
      <Slice2 id="measures" title="Measures" help={SOLUTION_PAGE_HELP.measures} text="Live, solution, and whether each measure is better or worse." />
      <Slice2 id="mrr" title="MRR over time" help={SOLUTION_PAGE_HELP.mrr} text="Monthly recurring revenue over the chosen horizon, live against with this solution." />
      <Slice2 id="stress" title="Market stress test" help={SOLUTION_PAGE_HELP.stress} text="Pass or fail and the key number under each market condition: Stable, Soft, Downturn, Boom and your own." />

      <div className="grid gap-4 md:grid-cols-2">
        <NotesCard
          key={solution.id}
          notes={solution.notes}
          canEdit={canEdit}
          onSave={async (notes) => {
            setError(null);
            if (mode === "demo") {
              setDemoNotes(solution.id, notes);
              return true;
            }
            const r = await saveSolutionNotes(workspaceId, solution.id, notes);
            if (r.status === "error") {
              setError(r.message);
              return false;
            }
            setLocal((d) => ({ ...d, solutions: d.solutions.map((s): SolutionRow => (s.id === solution.id ? { ...s, notes: r.notes } : s)) }));
            return true;
          }}
        />
        <div className="rounded-token border border-line bg-panel-2 px-4 py-3 text-sm" data-reminder>
          <span className="flex items-center font-semibold">
            Solutions never change the live map
            <Help {...SOLUTION_PAGE_HELP.never} />
          </span>
          <p className="mt-1 text-muted-foreground">To make one real, open the process in the Editor, build the new version and publish it.</p>
        </div>
      </div>

      <LinkIssueDialog
        open={linking}
        issues={toLink}
        onClose={() => setLinking(false)}
        onLink={async (issueId) => {
          setError(null);
          if (mode === "demo") {
            const issue = issueById.get(issueId);
            if (!issue) return "That issue isn't there any more.";
            addDemoLink(solution.id, issueId, await demoLinkVerdict(solution, issue));
            return null;
          }
          const r = await linkSolutionToIssue(workspaceId, solution.id, issueId);
          if (r.status === "error") return r.message;
          putLink(r.link);
          // The issue moved to Testing solutions: reload what the server knows.
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}

function SolvesCard({
  link,
  issue,
  base,
  canEdit,
  onVerdict,
  onNote,
}: {
  link: SolutionIssueRow;
  issue: IssueRow | undefined;
  base: string;
  canEdit: boolean;
  onVerdict: (v: SolutionVerdict | null) => void | Promise<void>;
  onNote: (notes: string) => void | Promise<void>;
}) {
  const [note, setNote] = useState(link.user_notes);
  const [noteFrom, setNoteFrom] = useState(link.user_notes);
  if (noteFrom !== link.user_notes) {
    setNoteFrom(link.user_notes);
    setNote(link.user_notes);
  }
  const target = issue ? [issue.target_measure, issue.target_goal].filter(Boolean).join(" ") : "";
  const press = (v: SolutionVerdict) => void onVerdict(link.user_verdict === v ? null : v);
  return (
    <Card className="gap-2 p-3" data-testid="solves-card" data-solves-card={link.issue_id}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {issue ? (
          <Link href={issueHref(base, issue)} className="min-w-0 font-semibold hover:underline">
            {issue.number == null ? "" : `#${issue.number} `}
            {issue.title}
          </Link>
        ) : (
          <span className="text-muted-foreground">An issue</span>
        )}
        {issue && (
          <span className="flex items-center">
            <StatusChip issue={issue} />
            <Help {...SOLUTION_PAGE_HELP.status} />
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center text-xs text-muted-foreground">
        <span>Target: {target || "not set"}</span>
        <Help {...SOLUTION_PAGE_HELP.target} />
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2" data-verdicts>
        <div className="flex flex-col gap-0.5">
          <span className={EYEBROW}>
            Automatic
            <Help {...SOLUTION_PAGE_HELP.automatic} />
          </span>
          <VerdictWord verdict={link.auto_verdict} />
        </div>
        {link.holds_pct !== null && (
          <div className="flex flex-col gap-0.5">
            <span className={EYEBROW}>
              Holds in
              <Help {...SOLUTION_PAGE_HELP.holds} />
            </span>
            <span className="font-mono text-sm" data-holds>
              {link.holds_pct}%
            </span>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className={EYEBROW}>
            Yours
            <Help {...SOLUTION_PAGE_HELP.yours} />
          </span>
          {canEdit ? (
            <div className="flex gap-1.5" role="group" aria-label="Your verdict">
              {(["pass", "fail"] as const).map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={link.user_verdict === v ? "default" : "outline"}
                  aria-pressed={link.user_verdict === v}
                  data-verdict-button={v}
                  onClick={() => press(v)}
                >
                  {v === "pass" ? "Pass" : "Fail"}
                </Button>
              ))}
            </div>
          ) : (
            <VerdictWord verdict={link.user_verdict} />
          )}
        </div>
      </div>
      {link.auto_note && <p className="text-xs">{link.auto_note}</p>}
      {(canEdit || link.user_notes) && (
        <label className="flex flex-col gap-0.5">
          <HelpLabel {...SOLUTION_PAGE_HELP.issueNote} />
          <Textarea
            value={note}
            maxLength={MAX_NOTES}
            disabled={!canEdit}
            rows={2}
            placeholder="Why you gave this verdict (optional)"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== link.user_notes && void onNote(note)}
          />
        </label>
      )}
    </Card>
  );
}

function Slice2({ id, title, text, help }: { id: string; title: string; text: string; help: { label: string; description: string; example: string } }) {
  return (
    <section className="flex flex-col gap-2" data-section={id} data-slice="2">
      <h2 className={`${CARD_TITLE} flex items-center`}>
        {title}
        <Help {...help} />
      </h2>
      <div className="rounded-token border border-dashed border-line p-4 text-sm text-muted-foreground" data-coming-next>
        Coming next. {text}
      </div>
    </section>
  );
}

function NotesCard({ notes, canEdit, onSave }: { notes: string; canEdit: boolean; onSave: (notes: string) => Promise<boolean> }) {
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Card className="gap-2 px-4 py-3" data-section="notes">
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>
          Notes
          <Help {...SOLUTION_PAGE_HELP.notes} />
        </span>
        <Textarea
          value={text}
          maxLength={MAX_NOTES}
          disabled={!canEdit}
          rows={4}
          aria-label="Notes"
          placeholder={canEdit ? "Anything worth knowing" : "No notes"}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          onBlur={() => {
            if (text === notes) return;
            void onSave(text).then((ok) => {
              setSaved(ok);
              if (ok) timer.current = setTimeout(() => setSaved(false), 2500);
            });
          }}
        />
      </label>
      <span className="h-4 text-xs text-muted-foreground" role="status">
        {saved ? "Saved" : ""}
      </span>
    </Card>
  );
}

function LinkIssueDialog({ open, issues, onLink, onClose }: { open: boolean; issues: IssueRow[]; onLink: (issueId: string) => Promise<string | null>; onClose: () => void }) {
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = issues.some((i) => i.id === picked) ? picked : (issues[0]?.id ?? "");
  const options = useMemo<ReactNode[]>(
    () =>
      issues.map((i) => (
        <option key={i.id} value={i.id}>
          {i.number == null ? "" : `#${i.number} `}
          {i.title}
        </option>
      )),
    [issues],
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-link-issue-dialog>
        <DialogHeader>
          <DialogTitle>Link an issue</DialogTitle>
          <DialogDescription>Test this solution against another open issue about the same process. It gets its own automatic verdict.</DialogDescription>
        </DialogHeader>
        {issues.length ? (
          <label className="flex flex-col gap-0.5">
            <HelpLabel {...SOLUTION_PAGE_HELP.link} label="Issue" />
            <NativeSelect aria-label="Issue" value={choice} onChange={(e) => setPicked(e.target.value)}>
              {options}
            </NativeSelect>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">There are no other open issues about this process to link.</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!choice || busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onLink(choice)
                .then((message) => (message ? setError(message) : onClose()))
                .finally(() => setBusy(false));
            }}
          >
            Link issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
