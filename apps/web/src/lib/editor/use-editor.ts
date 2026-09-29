"use client";

import { useState, useSyncExternalStore } from "react";
import type { ProcessBundle } from "@transpera-flow/db";
import { ProcessEditor, type EditorState } from "./editor";
import type { Stamp } from "./provenance";
import type { ProcessStore } from "./store";

/** One editor for the component's lifetime, over `bundle` as first loaded. */
export function useProcessEditor(
  bundle: ProcessBundle,
  createStore: () => ProcessStore,
  stamp?: () => Stamp,
): [EditorState, ProcessEditor] {
  const [editor] = useState(() => new ProcessEditor(bundle, createStore(), stamp));
  const state = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState);
  return [state, editor];
}
