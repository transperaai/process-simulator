// The demo's solutions (issue #114): an in-memory store the Editor's solution mode and the process page share for the length
// of the tab (like the demo's blocks, gone on reload). Saving here writes nothing but this list: the demo's live map and its
// draft are never touched, as in a workspace.

import { useSyncExternalStore } from "react";
import { NORTHBEAM_WORKSPACE_ID, type SolutionIssueRow, type SolutionRow } from "@transpera-flow/db";
import type { SolutionInput } from "./save";

interface DemoState {
  solutions: SolutionRow[];
  links: SolutionIssueRow[];
}

const EMPTY: DemoState = { solutions: [], links: [] };
let state: DemoState = EMPTY;
const listeners = new Set<() => void>();

/** Save a solution into the demo's list (this tab only), with a link per issue it was built for. */
export function addDemoSolution(input: SolutionInput): { solution: SolutionRow; links: SolutionIssueRow[] } {
  const now = new Date().toISOString();
  const solution: SolutionRow = {
    id: crypto.randomUUID(),
    workspace_id: NORTHBEAM_WORKSPACE_ID,
    process_id: input.processId,
    base_revision_id: input.baseRevisionId,
    name: input.name,
    notes: "",
    steps: structuredClone(input.copy),
    changed_step_ids: [...input.changedStepIds],
    lever_changes: structuredClone(input.levers),
    created_at: now,
    updated_at: now,
    created_by: null,
  };
  const links: SolutionIssueRow[] = input.links.map((l) => ({
    solution_id: solution.id,
    issue_id: l.issueId,
    workspace_id: NORTHBEAM_WORKSPACE_ID,
    auto_verdict: l.autoVerdict,
    holds_pct: l.holdsPct,
    auto_note: l.autoNote,
    user_verdict: null,
    user_notes: "",
    created_at: now,
    updated_at: now,
    created_by: null,
  }));
  state = { solutions: [solution, ...state.solutions], links: [...state.links, ...links] };
  for (const l of listeners) l();
  return { solution, links };
}

/** The demo's solutions, kept up to date as the Editor saves more. Server rendering and hydration see none. */
export function useDemoSolutions(): DemoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => state,
    () => EMPTY,
  );
}
