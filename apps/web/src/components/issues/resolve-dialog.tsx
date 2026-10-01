"use client";

// The Resolve dialog (issue #113, A48; prototype: "Resolve #N"): how the issue was resolved (a solution fixed it, we
// changed the process directly, or it is no longer a problem) and a note. It only collects them; the caller saves.

import { useState } from "react";
import type { ResolveHow } from "@transpera-flow/db";
import { Help, HelpLabel } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_NOTE } from "@/lib/issues/validate";
import { RESOLVE_HOW_LABELS, type SolutionTest } from "@/lib/issues/pages";

/** The (i) texts for the Resolve dialog: what each control does, in plain words, with an example. */
export const RESOLVE_HELP = {
  how: {
    label: "How was it resolved?",
    description: "Say what fixed the problem, so the history tells the story later. The issue leaves the map and the open list either way, and keeps its history.",
    example: "“We changed the process directly” when someone fixed it in the Editor without building a separate solution.",
  },
  solution: {
    label: "A solution fixed it",
    description: "Pick this when one of the solutions you tested is the fix, and you have built it into the live process.",
    example: "“Lead scoring” passed its test, and you built it into the live process.",
  },
  process: {
    label: "We changed the process directly",
    description: "Pick this when you edited the live process yourself and did not use a separate solution.",
    example: "You removed the manual review step in the Editor.",
  },
  gone: {
    label: "No longer a problem",
    description: "Pick this when something else changed, or it was a one-off, so there is nothing left to fix.",
    example: "The client who caused the delays left, and the wait is back to normal.",
  },
  pick: {
    label: "Solution",
    description: "Which of the solutions you tested fixed it. It is listed in the history.",
    example: "Lead scoring, which passed against this issue's target.",
  },
  note: {
    label: "Note",
    description: "A line for whoever reads the history later: what changed, and where. It is optional.",
    example: "Built into Sales version 8.",
  },
} as const;

const OPTIONS: { how: ResolveHow; help: (typeof RESOLVE_HELP)[keyof typeof RESOLVE_HELP]; text: string }[] = [
  { how: "solution", help: RESOLVE_HELP.solution, text: "Pick the solution you built into the live process." },
  { how: "process_change", help: RESOLVE_HELP.process, text: "Fixed in the Editor without a separate solution." },
  { how: "not_a_problem", help: RESOLVE_HELP.gone, text: "Something else changed, or it was a one-off." },
];

export interface ResolveDialogProps {
  open: boolean;
  issueNumber: number | null;
  issueTitle: string;
  /** Solutions tested for this issue (A49). None yet: "A solution fixed it" is disabled. */
  solutions: readonly SolutionTest[];
  onSubmit: (how: ResolveHow, note: string | null) => Promise<unknown>;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}

export function ResolveDialog(props: ResolveDialogProps) {
  const { open, issueNumber, issueTitle, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg" data-resolve-dialog>
        <DialogHeader>
          <DialogTitle>{issueNumber ? `Resolve #${issueNumber}` : "Resolve issue"}</DialogTitle>
          <DialogDescription>{issueTitle}</DialogDescription>
        </DialogHeader>
        {open && <Form {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ solutions, onSubmit, onClose, busy, error }: ResolveDialogProps) {
  const noSolutions = solutions.length === 0;
  const [how, setHow] = useState<ResolveHow>("process_change");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const submit = async () => {
    setWorking(true);
    try {
      if (await onSubmit(how, note.trim() || null)) onClose();
    } finally {
      setWorking(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center text-xs font-medium text-muted-foreground uppercase">
          {RESOLVE_HELP.how.label}
          <Help {...RESOLVE_HELP.how} />
        </legend>
        <div role="radiogroup" aria-label="How was it resolved?" className="flex flex-col gap-1.5">
          {OPTIONS.map(({ how: h, help, text }) => {
            // A solution can only be picked once solutions exist (A49).
            const disabled = h === "solution" && noSolutions;
            return (
              <label
                key={h}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${how === h ? "border-accent bg-accent/10" : "border-border"} ${disabled ? "opacity-60" : "cursor-pointer"}`}
              >
                <input type="radio" name="resolve-how" className="mt-1" checked={how === h} disabled={disabled} onChange={() => setHow(h)} />
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center font-medium">
                    {RESOLVE_HOW_LABELS[h]}
                    <Help {...help} />
                  </span>
                  <span className="text-xs text-muted-foreground">{disabled ? "No solutions tested for this issue yet." : text}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {how === "solution" && !noSolutions && (
        <label className="flex flex-col gap-0.5">
          <HelpLabel {...RESOLVE_HELP.pick} />
          <NativeSelect aria-label="Solution">
            {solutions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}

      <label className="flex flex-col gap-0.5">
        <HelpLabel {...RESOLVE_HELP.note} />
        <Textarea value={note} maxLength={MAX_NOTE} placeholder="e.g. Built into Sales version 8" onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">The issue leaves the map and the open list, but keeps its history.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={working || busy}>
          Mark resolved
        </Button>
      </DialogFooter>
    </form>
  );
}
