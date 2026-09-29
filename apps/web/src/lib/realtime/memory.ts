// Realtime in memory (issue #10): presence, notes and row changes between
// the tabs of one page, for the public demo (a simulated colleague) and
// tests. Messages queue until `flush()`, or flush themselves after
// `delayMs`, as a network would deliver them. `drop()` loses everything sent
// meanwhile, as a dropped connection does, until `restore()`.

import type { MemoryDraftEvents } from "@/lib/drafts/session";
import type { RemoteChange } from "./rows";
import type { Note, Present, ProcessChannel, ProcessChannelHandlers, RealtimeTransport, RevisionFeedHandlers } from "./transport";

interface Member {
  key: string;
  handlers: ProcessChannelHandlers;
  state: Present | null;
}

interface Feed {
  revisionId: string;
  handlers: RevisionFeedHandlers;
}

export class MemoryRealtime implements RealtimeTransport, MemoryDraftEvents {
  private members = new Set<Member>();
  private feeds = new Set<Feed>();
  private queue: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dropped = false;

  /** `delayMs`: deliver on its own after this long; null: only on `flush()`. */
  constructor(private readonly delayMs: number | null = null) {}

  joinProcess(_processId: string, key: string, handlers: ProcessChannelHandlers): ProcessChannel {
    const member: Member = { key, handlers, state: null };
    this.members.add(member);
    this.send(() => this.members.has(member) && handlers.status(this.dropped ? "offline" : "live"));
    this.send(() => this.members.has(member) && handlers.presence(this.present()));
    return {
      track: (state) => {
        member.state = { ...state, key };
        this.presenceChanged();
      },
      send: (note) => this.note(member, note),
      close: () => {
        this.members.delete(member);
        this.presenceChanged();
      },
    };
  }

  watchRevision(_processId: string, revisionId: string, handlers: RevisionFeedHandlers): { close(): void } {
    const feed: Feed = { revisionId, handlers };
    this.feeds.add(feed);
    this.send(() => this.feeds.has(feed) && handlers.status(this.dropped ? "offline" : "live"));
    return { close: () => this.feeds.delete(feed) };
  }

  /** A stored change to a revision's rows (MemoryDraftBackend calls this). */
  row(revisionId: string, change: RemoteChange): void {
    const copy = structuredClone(change);
    this.send(() => {
      for (const feed of this.feeds) if (feed.revisionId === revisionId) feed.handlers.row(copy);
    });
  }

  /** The process's revisions changed (MemoryDraftBackend calls this). */
  process(): void {
    this.send(() => {
      for (const feed of this.feeds) feed.handlers.process();
    });
  }

  /** Deliver everything queued. */
  flush(): void {
    while (this.queue.length) this.queue.shift()!();
  }

  /** Lose the connection: nothing sent meanwhile arrives. */
  drop(): void {
    this.dropped = true;
    this.queue = [];
    for (const m of this.members) m.handlers.status("offline");
    for (const f of this.feeds) f.handlers.status("offline");
  }

  /** Reconnect. */
  restore(): void {
    this.dropped = false;
    for (const m of this.members) m.handlers.status("live");
    for (const f of this.feeds) f.handlers.status("live");
    this.presenceChanged();
  }

  private present(): Present[] {
    return [...this.members].flatMap((m) => (m.state ? [m.state] : []));
  }

  private presenceChanged(): void {
    this.send(() => {
      const members = this.present();
      for (const m of this.members) m.handlers.presence(members);
    });
  }

  private note(from: Member, note: Note): void {
    const copy = structuredClone(note);
    // Like Supabase broadcast by default: not echoed to the sender.
    this.send(() => {
      for (const m of this.members) if (m !== from) m.handlers.note(copy);
    });
  }

  private send(fn: () => void): void {
    if (this.dropped) return;
    this.queue.push(fn);
    if (this.delayMs === null || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }
}
