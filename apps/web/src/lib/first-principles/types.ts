import type { FirstPrinciples } from "@transpera-flow/engine";

// What a save of first principles reports (issue #119): the same shape for the database and for the demo's tab store,
// so the flow doesn't care which it talks to.

export type FpSaveResult =
  | { status: "saved"; version: string | null; revisionId: string | null }
  /** Someone saved since the version you started from: their answers, to take or to overwrite. */
  | { status: "conflict"; doc: FirstPrinciples; version: string; revisionId: string }
  /** The draft you were editing was published or discarded: reload to carry on in the current one. */
  | { status: "stale" }
  | { status: "error"; message: string };

/** What the flow last knew about what is stored: the row's version and the revision (the draft) it belongs to. */
export interface FpBase {
  version: string | null;
  revisionId: string | null;
}

export type FpSaver = (doc: FirstPrinciples, base: FpBase) => Promise<FpSaveResult>;
