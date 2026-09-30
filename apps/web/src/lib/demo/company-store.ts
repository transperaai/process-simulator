"use client";

// The public demo's company model, suggestions and saved runs, in memory for
// this tab (issue #25). One store for the demo's pages, so a suggestion
// accepted on /demo/suggestions shows up in /demo/runs' "model changed since
// this run" banner, and a run saved on /demo is listed there. Lost on reload.

import { useSyncExternalStore } from "react";
import type { CompanyModel, RunRow, SuggestionRow } from "@transpera-flow/db";
import { reviewInMemory, type SuggestionBackend } from "@/lib/suggestions/review";
import { demoCompany, demoSuggestions } from "@/lib/suggestions/demo";

export interface DemoCompanyState {
  model: CompanyModel;
  suggestions: SuggestionRow[];
  /** Runs saved in this tab, newest first. */
  runs: RunRow[];
}

let initial: DemoCompanyState | null = null;
let state: DemoCompanyState | null = null;
const listeners = new Set<() => void>();

function first(): DemoCompanyState {
  initial ??= { model: demoCompany(), suggestions: demoSuggestions(), runs: [] };
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
