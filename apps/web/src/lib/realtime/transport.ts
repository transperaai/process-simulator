// What the editor needs from Realtime (issue #10), as a port: presence and
// notes on the process's channel, and the rows of the revision being edited.
// `supabaseTransport` (./supabase-transport.ts) implements it with Supabase
// Realtime; `MemoryRealtime` (./memory.ts) in memory for the demo and tests.

import type { Patch, Table } from "@/lib/editor/ops";
import type { RemoteChange } from "./rows";

/** The Live / Draft switch on the process page. */
export type View = "live" | "draft";

/** A signed-in person, as others see them. */
export interface Viewer {
  userId: string;
  name: string;
  email: string | null;
}

/** What each open tab tracks on the process's presence channel. */
export interface PresenceState extends Viewer {
  view: View;
  /** When this tab joined (ISO), for a stable order. */
  since: string;
}

/** One tab on the process, keyed by its presence key (one per tab). */
export interface Present extends PresenceState {
  key: string;
}

/**
 * What an editor broadcasts after saving, so the others can say who changed
 * what. Only for naming people: the data itself comes from the database.
 */
export type Note =
  | { kind: "saved"; by: Viewer; table: Table; id: string; values: Patch }
  | { kind: "rows"; by: Viewer; op: "insert" | "remove"; steps: string[]; edges: string[] }
  | { kind: "draft"; by: Viewer; event: "opened" | "published" | "discarded"; revisionId: string };

export type ChannelStatus = "connecting" | "live" | "offline";

export interface ProcessChannelHandlers {
  /** Everyone on the channel now, this tab included. */
  presence(members: Present[]): void;
  note(note: Note): void;
  status(status: ChannelStatus): void;
}

export interface ProcessChannel {
  /** Set (or replace) this tab's presence; kept across reconnects. */
  track(state: PresenceState): void;
  send(note: Note): void;
  close(): void;
}

export interface RevisionFeedHandlers {
  /** A step or edge of the watched revision was saved. */
  row(change: RemoteChange): void;
  /** The process row changed: a draft was opened, published or discarded. */
  process(): void;
  /** "live" again after "offline" means changes may have been missed. */
  status(status: ChannelStatus): void;
}

export interface RealtimeTransport {
  /** Presence and notes on the process's channel; `key` identifies this tab. */
  joinProcess(processId: string, key: string, handlers: ProcessChannelHandlers): ProcessChannel;
  /** Saved changes to one revision's steps and edges, and to the process row. */
  watchRevision(processId: string, revisionId: string, handlers: RevisionFeedHandlers): { close(): void };
}
