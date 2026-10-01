"use client";

// The public demo's hidden levers, in memory for this tab (issue #123): switching a lever off on the demo's Levers
// page takes its sliders off the demo's process page. Lost on reload, like the rest of the demo.

import { useSyncExternalStore } from "react";

const NONE: string[] = [];
let state: string[] = NONE;
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setDemoHiddenLevers(next: string[]): void {
  state = next;
  for (const l of listeners) l();
}

/** The demo's hidden levers as they are now, for a page that starts from them. */
export const getDemoHiddenLevers = (): string[] => state;

/** The demo's hidden levers, re-rendering when they change. */
export function useDemoHiddenLevers(): string[] {
  return useSyncExternalStore(subscribe, () => state, () => NONE);
}
