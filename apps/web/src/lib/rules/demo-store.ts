"use client";

// The public demo's analysis rules, in memory for this tab (issue #109): editing them on the demo's rules page
// re-rates the issues the demo's process page shows. Lost on reload, like the rest of the demo.

import { useSyncExternalStore } from "react";
import type { AnalysisSettings } from "@transpera-flow/engine";

const EMPTY: AnalysisSettings = {};
let state: AnalysisSettings = EMPTY;
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setDemoAnalysisRules(next: AnalysisSettings): void {
  state = next;
  for (const l of listeners) l();
}

/** The demo's rules, re-rendering when they change. */
export function useDemoAnalysisRules(): AnalysisSettings {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
