"use client";

import { useState, useSyncExternalStore } from "react";
import type { ProcessBundle } from "@transpera-flow/db";
import type { EditorState } from "@/lib/editor/editor";
import { DraftSession, type DraftBackend, type DraftState } from "./session";

/** One draft session (and its editor) for the component's lifetime, over the process as first loaded. */
export function useDraftSession(
  live: ProcessBundle,
  draft: ProcessBundle | null,
  createBackend: () => DraftBackend,
): [DraftSession, DraftState, EditorState] {
  const [session] = useState(
    () => new DraftSession(live, draft ? { bundle: draft, number: draft.revision.number } : null, createBackend()),
  );
  const drafts = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const editor = useSyncExternalStore(session.editor.subscribe, session.editor.getState, session.editor.getState);
  return [session, drafts, editor];
}
