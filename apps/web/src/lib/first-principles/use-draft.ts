"use client";

// The flow's working copy of the answers (issue #119): every edit changes it at once and is saved a moment later,
// the whole document in one compare-and-set so two people editing at once are told instead of one silently undoing
// the other. One save runs at a time; an edit made while one runs is saved right after it. Leaving the page saves
// what is waiting.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FirstPrinciples } from "@transpera-flow/engine";
import type { FpBase, FpSaver } from "./types";

export type DraftStatus = "saved" | "unsaved" | "saving" | "error" | "conflict" | "stale";

export const SAVE_DELAY_MS = 700;

export interface FirstPrinciplesDraft {
  doc: FirstPrinciples;
  status: DraftStatus;
  message: string | null;
  /** Their answers, while the status is "conflict". */
  theirs: FirstPrinciples | null;
  edit: (change: (doc: FirstPrinciples) => FirstPrinciples) => void;
  /** Save now, without waiting for the pause. */
  flush: () => Promise<void>;
  /** Conflict: keep what is on screen and overwrite theirs. */
  keepMine: () => void;
  /** Conflict: throw away what is on screen and take theirs. */
  takeTheirs: () => void;
}

export function useFirstPrinciplesDraft({
  initial,
  base: initialBase,
  save,
  canEdit,
}: {
  initial: FirstPrinciples;
  base: FpBase;
  save: FpSaver;
  canEdit: boolean;
}): FirstPrinciplesDraft {
  const [doc, setDoc] = useState(initial);
  const [status, setStatus] = useState<DraftStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<FirstPrinciples | null>(null);
  const docRef = useRef(doc);
  const baseRef = useRef(initialBase);
  const dirty = useRef(false);
  const running = useRef(false);
  /** A conflict or a gone draft is settled by the person, not retried on a timer. */
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const runRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const run = useCallback(async () => {
    if (running.current || blocked.current || !dirty.current) return;
    running.current = true;
    dirty.current = false;
    setStatus("saving");
    const sent = docRef.current;
    try {
      const r = await saveRef.current(sent, baseRef.current);
      if (r.status === "saved") {
        baseRef.current = { version: r.version, revisionId: r.revisionId ?? baseRef.current.revisionId };
        setMessage(null);
        setStatus(dirty.current ? "unsaved" : "saved");
      } else if (r.status === "conflict") {
        dirty.current = true;
        blocked.current = true;
        setTheirs(r.doc);
        baseRef.current = { version: r.version, revisionId: r.revisionId };
        setStatus("conflict");
      } else if (r.status === "stale") {
        dirty.current = true;
        blocked.current = true;
        setStatus("stale");
      } else {
        dirty.current = true;
        setMessage(r.message);
        setStatus("error");
      }
    } catch {
      dirty.current = true;
      setMessage("Couldn't save. Check your connection and try again.");
      setStatus("error");
    } finally {
      running.current = false;
    }
    // An edit made while the save ran.
    if (dirty.current && !blocked.current && docRef.current !== sent) {
      timer.current = setTimeout(() => void runRef.current(), SAVE_DELAY_MS);
    }
  }, []);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const edit = useCallback(
    (change: (d: FirstPrinciples) => FirstPrinciples) => {
      if (!canEdit) return;
      const next = change(docRef.current);
      docRef.current = next;
      dirty.current = true;
      setDoc(next);
      setStatus((s) => (s === "conflict" || s === "stale" ? s : "unsaved"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), SAVE_DELAY_MS);
    },
    [canEdit, run],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await run();
  }, [run]);

  const keepMine = useCallback(() => {
    setTheirs(null);
    blocked.current = false;
    dirty.current = true;
    setStatus("unsaved");
    void flush();
  }, [flush]);

  const takeTheirs = useCallback(() => {
    if (!theirs) return;
    docRef.current = theirs;
    dirty.current = false;
    blocked.current = false;
    setDoc(theirs);
    setTheirs(null);
    setStatus("saved");
  }, [theirs]);

  // Leaving the page saves what is waiting.
  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
      if (dirty.current && !running.current && !blocked.current) void saveRef.current(docRef.current, baseRef.current);
    };
  }, []);

  return { doc, status, message, theirs, edit, flush, keepMine, takeTheirs };
}
