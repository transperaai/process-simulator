"use client";

import { useCallback, useState } from "react";
import type { IssueRow } from "@transpera-flow/db";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { liveIssueStore } from "./live-store";
import { MemoryIssueStore, type IssueStore, type SaveIssueResult } from "./store";
import type { IssueField, IssueInput, PromoteInput, SaveIssueInput, Scalar } from "./validate";

export interface IssuesState {
  issues: IssueRow[];
  busy: boolean;
  error: string | null;
  create(input: IssueInput): Promise<IssueRow | null>;
  promote(input: PromoteInput): Promise<IssueRow | null>;
  /** The Acknowledge dialog: create an issue (from an insight or by hand) or edit one. Null when it failed; `error` says why. */
  save(input: SaveIssueInput): Promise<IssueRow | null>;
  /** A saver for one field of one issue that also updates the list once saved. */
  saver(id: string, field: IssueField): Saver<Scalar>;
  remove(id: string): Promise<boolean>;
  dismissError(): void;
}

/**
 * Tracked issues and the writes on them. `live` saves through Server Actions
 * as the signed-in user; `demo` keeps them in memory (lost on reload).
 */
export function useIssues(workspaceId: string, initial: readonly IssueRow[], mode: "live" | "demo" | "readonly"): IssuesState {
  const [store] = useState<IssueStore>(() => (mode === "live" ? liveIssueStore(workspaceId) : new MemoryIssueStore(workspaceId, initial)));
  const [issues, setIssues] = useState<IssueRow[]>(() => [...initial]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async (write: () => Promise<SaveIssueResult>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await write();
      if (r.status === "error") {
        setError(r.message);
        return null;
      }
      setIssues((list) => [r.issue, ...list.filter((i) => i.id !== r.issue.id)]);
      return r.issue;
    } catch {
      setError("Couldn't save. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const saver = useCallback(
    (id: string, field: IssueField): Saver<Scalar> =>
      async (base, next) => {
        const outcome: SaveOutcome<Scalar> = await store.saveField(id, field, base, next);
        if (outcome.status === "saved") {
          setIssues((list) => list.map((i) => (i.id === id ? ({ ...i, [field]: outcome.value, updated_at: new Date().toISOString() } as IssueRow) : i)));
        }
        return outcome;
      },
    [store],
  );

  return {
    issues,
    busy,
    error,
    create: (input) => add(() => store.create(input)),
    promote: (input) => add(() => store.promote(input)),
    save: (input) => add(() => store.save(input)),
    saver,
    remove: async (id) => {
      setBusy(true);
      setError(null);
      try {
        const r = await store.remove(id);
        if (r.status === "error") {
          setError(r.message);
          return false;
        }
        setIssues((list) => list.filter((i) => i.id !== id));
        return true;
      } catch {
        setError("Couldn't delete. Try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    dismissError: () => setError(null),
  };
}
