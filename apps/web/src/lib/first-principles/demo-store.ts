"use client";

// The public demo's first principles, in memory for this tab (issue #119): what the flow edits on the demo and the
// summary card reads, lost on reload like the rest of the demo. The Northbeam pipeline starts with a worked example
// (`demoFirstPrinciples`), so the flow and the card have something to show; other processes start empty.

import { useSyncExternalStore } from "react";
import { NORTHBEAM_PROCESS_ID } from "@transpera-flow/db";
import { emptyFirstPrinciples, normalizeFirstPrinciples, type FirstPrinciples } from "@transpera-flow/engine";
import { demoFirstPrinciples } from "./demo-seed";

const state = new Map<string, FirstPrinciples>();
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The demo's answers for a process as they are now: the example for the pipeline, empty for the rest. The same object until they change. */
export function getDemoFirstPrinciples(processId: string): FirstPrinciples {
  let doc = state.get(processId);
  if (!doc) {
    doc = processId === NORTHBEAM_PROCESS_ID ? demoFirstPrinciples() : emptyFirstPrinciples();
    state.set(processId, doc);
  }
  return doc;
}

export function setDemoFirstPrinciples(processId: string, doc: FirstPrinciples): void {
  state.set(processId, normalizeFirstPrinciples(doc));
  for (const l of listeners) l();
}

/** The demo's first principles for a process, re-rendering when they change. */
export function useDemoFirstPrinciples(processId: string): FirstPrinciples {
  return useSyncExternalStore(
    subscribe,
    () => getDemoFirstPrinciples(processId),
    () => getDemoFirstPrinciples(processId),
  );
}
