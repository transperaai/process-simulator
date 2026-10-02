"use client";

// The public demo's company model, suggestions and saved runs, in memory for
// this tab (issue #25). Lost on reload.

import { useSyncExternalStore } from "react";
import { NORTHBEAM_WORKSPACE_ID, northbeamIssues, type CompanyModel, type ProposalRow, type RunRow, type SuggestionRow } from "@transpera-flow/db";
import { MemoryIssueStore } from "@/lib/issues/store";
import { reviewProposalsInMemory, type ProposalBackend } from "@/lib/suggestions/proposals";
import { reviewInMemory, type SuggestionBackend } from "@/lib/suggestions/review";
import { demoCompany, demoProposals, demoSuggestions } from "@/lib/suggestions/demo";

export interface DemoCompanyState {
  model: CompanyModel;
  suggestions: SuggestionRow[];
  /** Proposed issues and solution ideas (A52). */
  proposals: ProposalRow[];
  /** Runs saved in this tab, newest first. */
  runs: RunRow[];
}

let initial: DemoCompanyState | null = null;
let state: DemoCompanyState | null = null;
const listeners = new Set<() => void>();

function first(): DemoCompanyState {
  initial ??= { model: demoCompany(), suggestions: demoSuggestions(), proposals: demoProposals(), runs: [] };
  return initial;
}

const get = () => (state ??= first());
const set = (next: DemoCompanyState) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The demo's company model, suggestions and saved runs, re-rendering when they change. */
export function useDemoCompany(): DemoCompanyState {
  return useSyncExternalStore(subscribe, get, first);
}

/** Reviews suggestions in memory, as the database would. */
export const demoSuggestionBackend: SuggestionBackend = {
  async review(ids, decision, note) {
    const now = get();
    const next = reviewInMemory(now, ids, decision, note, { at: new Date().toISOString(), by: null, newId: () => crypto.randomUUID() });
    set({ ...now, model: next.model, suggestions: next.suggestions });
    return { status: "ok", results: next.results, suggestions: next.suggestions, model: next.model };
  },
};

/** Keep a run saved on the demo's process page. */
export function saveDemoRun(run: RunRow): void {
  const now = get();
  set({ ...now, runs: [run, ...now.runs] });
}

/** Where accepted proposals become issues on the demo: the issue store's own `save`, as the Acknowledge dialog uses. */
let issues: MemoryIssueStore | null = null;

/** Reviews proposals in memory, as the database would. An accepted issue is numbered after Northbeam's sample issues. */
export const demoProposalBackend: ProposalBackend = {
  async review(ids, decision, note) {
    issues ??= new MemoryIssueStore(NORTHBEAM_WORKSPACE_ID, northbeamIssues());
    const now = get();
    const next = await reviewProposalsInMemory(now.proposals, ids, decision, note, { at: new Date().toISOString(), by: null, issues });
    set({ ...now, proposals: next.proposals });
    return { status: "ok", results: next.results, proposals: next.proposals };
  },
};
