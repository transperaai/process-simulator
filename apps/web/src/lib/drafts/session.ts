// Draft mode in the editor (issue #9, PRD §7.1b). A process has one live
// revision and at most one draft. The editor always edits the draft: its
// first save opens one (a copy of live with the same ids) and later saves
// continue it, so the live revision never changes until Publish. Discard
// throws the draft away. Framework-free so it can be unit tested;
// `useDraftSession` wraps it for React.

import type { EdgeRow, ProcessBundle, StepRow } from "@transpera-flow/db";
import { ProcessEditor } from "@/lib/editor/editor";
import type { Stamp } from "@/lib/editor/provenance";
import { MemoryStore, type ProcessStore, type WriteResult } from "@/lib/editor/store";
import type { RemoteChange } from "@/lib/realtime/rows";
import { unresolvedSteps } from "./diff";

export interface RevisionInfo {
  id: string;
  number: number;
}

export type OpenResult = { status: "ok"; revision: RevisionInfo; created: boolean } | { status: "error"; message: string };

export type PublishResult =
  | { status: "published"; revision: RevisionInfo }
  /** Steps still marked as assumptions (or conflicts); nothing was published. */
  | { status: "unresolved"; steps: { id: string; name: string }[] }
  | { status: "error"; message: string };

/** Where drafts live: the database (through Server Actions) or memory (the demo, tests). */
export interface DraftBackend {
  /** The process's draft, opened from live if there is none. Idempotent. */
  open(): Promise<OpenResult>;
  discard(): Promise<WriteResult>;
  publish(acceptEstimates: boolean): Promise<PublishResult>;
  /** Saves into a draft revision. */
  store(revisionId: string): ProcessStore;
  /**
   * The process's live revision and open draft as stored now: another editor
   * may have opened, published or discarded one (issue #10). Null if unknown.
   */
  revisions?(): Promise<{ live: RevisionInfo; draft: RevisionInfo | null } | null>;
  /** A revision's steps and edges as stored now, or null if unknown. */
  rows?(revisionId: string): Promise<RevisionRows | null>;
}

export interface RevisionRows {
  steps: StepRow[];
  edges: EdgeRow[];
}

/** Stored changes a MemoryDraftBackend reports, as Realtime would. */
export interface MemoryDraftEvents {
  row(revisionId: string, change: RemoteChange): void;
  process(): void;
}

export type DraftEvent = "opened" | "published" | "discarded";
export type DraftListener = (event: DraftEvent, revisionId: string) => void;

/** Who did something to the draft, if known ("Tom"), for notices. */
export type DraftActor = (event: DraftEvent, revisionId: string) => string | null;

export interface DraftState {
  /** The live revision, as loaded or as last published here. */
  live: ProcessBundle;
  /** The open draft; null until the first edit opens one. */
  draft: RevisionInfo | null;
  /** The first edit is opening a draft. */
  opening: boolean;
  busy: "publishing" | "discarding" | null;
  /** Steps a refused publish listed as unresolved, until published or dismissed. */
  unresolved: { id: string; name: string }[] | null;
  /** What just happened ("Published revision 3."), until dismissed. */
  notice: string | null;
  error: string | null;
}

export class DraftSession {
  readonly editor: ProcessEditor;
  private state: DraftState;
  private listeners = new Set<() => void>();
  private opening: Promise<string | null> | null = null;

  constructor(
    live: ProcessBundle,
    draft: { bundle: ProcessBundle; number: number } | null,
    private readonly backend: DraftBackend,
    /** Who is editing, and when: step parameters they change in the draft are recorded as entered (lib/editor/provenance.ts). */
    stamp?: () => Stamp,
  ) {
    this.state = {
      live,
      draft: draft ? { id: draft.bundle.revision.id, number: draft.number } : null,
      opening: false,
      busy: null,
      unresolved: null,
      notice: null,
      error: null,
    };
    this.editor = new ProcessEditor(draft?.bundle ?? live, this.store, stamp);
  }

  getState = (): DraftState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether a draft exists or is being opened. */
  hasDraft(): boolean {
    return this.state.draft !== null || this.state.opening;
  }

  /** The editor's store: every write goes to the draft, opening it first if needed. */
  private readonly store: ProcessStore = {
    insert: async (steps, edges) => {
      const id = await this.draftId();
      return id ? this.backend.store(id).insert(steps, edges) : this.openFailed();
    },
    remove: async (stepIds, edgeIds) => {
      const id = await this.draftId();
      return id ? this.backend.store(id).remove(stepIds, edgeIds) : this.openFailed();
    },
    update: async (table, rowId, base, next) => {
      const id = await this.draftId();
      return id ? this.backend.store(id).update(table, rowId, base, next) : this.openFailed();
    },
  };

  private openError = "Couldn't open a draft.";

  private openFailed(): { status: "error"; message: string } {
    return { status: "error", message: this.openError };
  }

  private draftId(): Promise<string | null> {
    if (this.state.draft) return Promise.resolve(this.state.draft.id);
    if (!this.opening) {
      this.set({ opening: true });
      this.opening = this.backend.open().then(
        (r) => {
          this.opening = null;
          if (r.status !== "ok") {
            this.openError = r.message;
            this.set({ opening: false });
            return null;
          }
          this.set({
            opening: false,
            draft: r.revision,
            // Someone else's draft was already open: their changes are in it, not on this screen yet
            // (with live updates, the catch-up that follows brings them in).
            notice: r.created
              ? null
              : this.backend.rows
                ? "Someone else already had a draft of this process open; your edits went into it, alongside theirs."
                : "Someone else already had a draft of this process open; your edits went into it. Reload to see their changes.",
          });
          if (r.created) this.emit("opened", r.revision.id);
          return r.revision.id;
        },
        () => {
          this.opening = null;
          this.openError = "Couldn't open a draft. Check your connection and try again.";
          this.set({ opening: false });
          return null;
        },
      );
    }
    return this.opening;
  }

  /**
   * Make the draft live. Refused (and reported in `unresolved`) while steps
   * are unconfirmed estimates, unless `acceptEstimates`.
   */
  async publish(acceptEstimates = false): Promise<PublishResult | null> {
    if (this.state.busy) return null;
    this.set({ busy: "publishing", error: null, notice: null });
    await this.editor.settled();
    if (!this.state.draft) {
      this.set({ busy: null });
      return null;
    }
    let r: PublishResult;
    try {
      r = await this.backend.publish(acceptEstimates);
    } catch {
      r = { status: "error", message: "Couldn't publish. Check your connection and try again." };
    }
    if (r.status === "published") {
      const bundle = this.editor.getState().bundle;
      const live: ProcessBundle = { ...bundle, revision: { ...bundle.revision, id: r.revision.id, number: r.revision.number, status: "published" } };
      this.editor.reset(live);
      const accepted = acceptEstimates && unresolvedSteps(live).length;
      this.set({
        live,
        draft: null,
        busy: null,
        unresolved: null,
        notice: `Published revision ${r.revision.number}${accepted ? `, with ${accepted} step${accepted === 1 ? "" : "s"} accepted as estimates` : ""}. It is now the live model.`,
      });
      this.emit("published", r.revision.id);
    } else if (r.status === "unresolved") {
      this.set({ busy: null, unresolved: r.steps });
    } else {
      this.set({ busy: null, error: r.message });
    }
    return r;
  }

  /** Throw the whole draft away; the editor goes back to live. */
  async discard(): Promise<boolean> {
    if (this.state.busy) return false;
    this.set({ busy: "discarding", error: null, notice: null });
    await this.editor.settled();
    let r: WriteResult = { status: "ok" };
    if (this.state.draft) {
      try {
        r = await this.backend.discard();
      } catch {
        r = { status: "error", message: "Couldn't discard the draft. Check your connection and try again." };
      }
    }
    if (r.status !== "ok") {
      this.set({ busy: null, error: r.message });
      return false;
    }
    const discarded = this.state.draft?.id;
    this.editor.reset(this.state.live);
    this.set({ draft: null, busy: null, unresolved: null, notice: "Draft discarded. You're looking at the live model." });
    if (discarded) this.emit("discarded", discarded);
    return true;
  }

  private draftListeners = new Set<DraftListener>();

  /** Listen for this session opening, publishing or discarding a draft (to tell others who did). */
  onDraftEvent(listener: DraftListener): () => void {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  }

  private emit(event: DraftEvent, revisionId: string): void {
    for (const listener of this.draftListeners) listener(event, revisionId);
  }

  dismiss(): void {
    this.set({ notice: null, error: null, unresolved: null });
  }

  /** The revision the editor shows and saves into: the draft, or live while there is none. */
  currentRevision(): string {
    return this.state.draft?.id ?? this.state.live.revision.id;
  }

  private reconciling: Promise<void> = Promise.resolve();

  /**
   * Catch up with the process as stored (issue #10): after a reconnect, or
   * when Realtime says the process's revisions changed. Someone else may have
   * opened a draft (edits now go into it), published it (it is now live;
   * history is cleared, as after our own publish) or discarded it (back to
   * live). Then the editor's copy is brought in line with the stored rows,
   * keeping our own unsaved work. Calls run one at a time.
   */
  reconcile(actor: DraftActor = () => null): Promise<void> {
    this.reconciling = this.reconciling.then(() => this.catchUp(actor)).catch(() => undefined);
    return this.reconciling;
  }

  private async catchUp(actor: DraftActor): Promise<void> {
    const { revisions, rows } = this.backend;
    if (!revisions || !rows || this.state.busy || this.state.opening) return;
    const stored = await revisions.call(this.backend);
    // Our own open, publish or discard started meanwhile: its result wins, and the next event catches up.
    if (!stored || this.state.busy || this.state.opening) return;
    const who = (event: Parameters<DraftActor>[0], id: string) => actor(event, id) ?? "Someone else";
    const mine = this.state.draft;

    if (stored.live.id !== this.state.live.revision.id) {
      // Published by someone else (our draft, if we had it open, is now live).
      await this.editor.settled();
      const liveRows = await rows.call(this.backend, stored.live.id);
      if (!liveRows) return;
      const bundle = this.editor.getState().bundle;
      const live: ProcessBundle = {
        ...bundle,
        ...liveRows,
        revision: { ...bundle.revision, id: stored.live.id, number: stored.live.number, status: "published" },
      };
      this.editor.reset(live);
      this.set({
        live,
        draft: null,
        unresolved: null,
        notice: `${who("published", stored.live.id)} published ${mine ? "the draft" : "a new version"} as revision ${stored.live.number}. It is now the live model.`,
      });
    } else if (mine && stored.draft?.id !== mine.id) {
      // Discarded by someone else.
      await this.editor.settled();
      this.editor.reset(this.state.live);
      this.set({ draft: null, unresolved: null, notice: `${who("discarded", mine.id)} discarded the draft. You're looking at the live model.` });
    }

    if (!this.state.draft && stored.draft) {
      // Someone else opened a draft: our edits now go into it too, and their changes show as they save them.
      this.set({
        draft: stored.draft,
        notice: `${who("opened", stored.draft.id)} started a draft (r${stored.draft.number}). Edits go into it; the live model changes only when it is published.`,
      });
    }

    const current = await rows.call(this.backend, this.currentRevision());
    if (current && !this.state.busy) this.editor.resync(current);
  }

  private set(patch: Partial<DraftState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/**
 * Drafts in memory, with the database's rules: one draft at a time, copied
 * from live with the same ids, publishing refused while steps are estimates
 * unless accepted. For the public demo and tests.
 */
export class MemoryDraftBackend implements DraftBackend {
  private live: MemoryStore;
  private liveRevision: RevisionInfo;
  private draft: { store: MemoryStore; revision: RevisionInfo } | null = null;
  private revisionCount = 0;
  /** Publishes, newest last, as the audit log would record them. */
  readonly published: { number: number; acceptEstimates: boolean; estimates: string[] }[] = [];

  /**
   * `events` hears every stored change, as Realtime would report it: rows of
   * a revision, and the process's revisions changing (open, publish,
   * discard). The demo feeds them to its in-memory Realtime.
   */
  constructor(
    live: ProcessBundle,
    private readonly events: MemoryDraftEvents | null = null,
  ) {
    this.liveRevision = { id: live.revision.id, number: live.revision.number };
    this.live = this.storeFor(live, this.liveRevision.id);
    this.revisionCount = live.revision.number;
  }

  private storeFor(rows: Pick<ProcessBundle, "steps" | "edges">, revisionId: string): MemoryStore {
    const events = this.events;
    return new MemoryStore(rows, events ? (change) => events.row(revisionId, change) : null);
  }

  async revisions(): Promise<{ live: RevisionInfo; draft: RevisionInfo | null }> {
    return { live: this.liveRevision, draft: this.draft?.revision ?? null };
  }

  async rows(revisionId: string): Promise<RevisionRows | null> {
    if (revisionId === this.liveRevision.id) return this.live.snapshot();
    return this.draft?.revision.id === revisionId ? this.draft.store.snapshot() : null;
  }

  /** What a run of the live model loads. */
  liveRows() {
    return this.live.snapshot();
  }

  draftRows() {
    return this.draft?.store.snapshot() ?? null;
  }

  liveRevisionInfo(): RevisionInfo {
    return this.liveRevision;
  }

  async open(): Promise<OpenResult> {
    if (this.draft) return { status: "ok", revision: this.draft.revision, created: false };
    this.revisionCount += 1;
    const revision = { id: crypto.randomUUID(), number: this.revisionCount };
    this.draft = { store: this.storeFor(this.live.snapshot(), revision.id), revision };
    this.events?.process();
    return { status: "ok", revision: this.draft.revision, created: true };
  }

  async discard(): Promise<WriteResult> {
    if (this.draft) this.revisionCount -= 1;
    const had = this.draft !== null;
    this.draft = null;
    if (had) this.events?.process();
    return { status: "ok" };
  }

  async publish(acceptEstimates: boolean): Promise<PublishResult> {
    if (!this.draft) return { status: "error", message: "There is no draft to publish." };
    const rows = this.draft.store.snapshot();
    const estimates = unresolvedSteps(rows).map((s) => ({ id: s.id, name: s.name }));
    if (estimates.length && !acceptEstimates) return { status: "unresolved", steps: estimates };
    this.live = this.draft.store;
    this.liveRevision = this.draft.revision;
    this.published.push({ number: this.draft.revision.number, acceptEstimates, estimates: estimates.map((s) => s.id) });
    this.draft = null;
    this.events?.process();
    return { status: "published", revision: this.liveRevision };
  }

  store(revisionId: string): ProcessStore {
    const draft = this.draft;
    if (!draft || draft.revision.id !== revisionId) {
      const gone = { status: "error" as const, message: "This draft was published or discarded. Reload to continue." };
      return { insert: async () => gone, remove: async () => gone, update: async () => gone };
    }
    return draft.store;
  }
}
