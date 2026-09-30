// A simulated colleague for the public demo (issue #10): someone else on the
// process, so presence, live changes and same-field conflicts can be tried
// without Supabase or a second browser. They save through the same in-memory
// "database" (MemoryDraftBackend) and show up through the same in-memory
// Realtime as a real colleague would, so the editor can't tell the difference.

import { isRetiredStep, type ProcessBundle, type StepRow } from "@transpera-flow/db";
import type { DraftBackend, MemoryDraftBackend } from "@/lib/drafts/session";
import { formatHours } from "@/lib/format";
import { sameScalar } from "@/lib/editor/commands";
import { readField, type Patch, type Table, type Value } from "@/lib/editor/ops";
import type { MemoryRealtime } from "./memory";
import type { ProcessChannel, Viewer } from "./transport";

export const COLLEAGUE: Viewer = { userId: "demo-colleague", name: "Tom", email: "tom@example.com" };

export class DemoColleague {
  private channel: ProcessChannel | null = null;
  /** Set: Tom saves the same field just before your next save of it. */
  private racing = false;
  private turn = 0;

  constructor(
    private readonly backend: MemoryDraftBackend,
    private readonly realtime: MemoryRealtime,
    private readonly processId: string,
  ) {}

  get present(): boolean {
    return this.channel !== null;
  }

  join(view: "live" | "draft" = "draft"): void {
    if (!this.channel) {
      this.channel = this.realtime.joinProcess(this.processId, "demo-colleague-tab", {
        presence: () => undefined,
        note: () => undefined,
        status: () => undefined,
      });
    }
    this.channel.track({ ...COLLEAGUE, view, since: new Date().toISOString() });
  }

  leave(): void {
    this.channel?.close();
    this.channel = null;
    this.racing = false;
  }

  /** Tom changes one step's hands-on time (a different step each time). Returns what he did. */
  async editSomething(prefer?: string): Promise<string | null> {
    const draft = await this.draft();
    if (!draft) return null;
    const rows = this.backend.draftRows()!;
    const working = rows.steps.filter((s) => s.kind !== "start" && s.kind !== "end" && !isRetiredStep(s));
    const target = working.find((s) => s.id === prefer) ?? working[this.turn++ % working.length];
    if (!target) return null;
    const hours = Number(target.work_hours);
    const next = Math.max(0.5, Math.round((hours >= 4 ? hours / 2 : hours * 2) * 2) / 2);
    const field = target.work_dist === "triangular" ? "name" : "work_hours";
    const value: Value = field === "name" ? `${target.name} (checked)` : next;
    await this.save(draft, "steps", target.id, field, readField(target, field), value);
    return field === "name" ? `Tom renamed ${target.name}` : `Tom set ${target.name}'s hands-on time to ${formatHours(next)}`;
  }

  /** Tom saves the same field just before your next save of any field, so your save meets a conflict. */
  race(on: boolean): void {
    this.racing = on;
  }

  get isRacing(): boolean {
    return this.racing;
  }

  /** The backend the editor uses: the demo's, with Tom racing your next save when asked. */
  wrap(backend: DraftBackend): DraftBackend {
    return {
      ...backend,
      open: () => backend.open(),
      discard: () => backend.discard(),
      publish: (accept) => backend.publish(accept),
      revisions: backend.revisions?.bind(backend),
      rows: backend.rows?.bind(backend),
      store: (revisionId) => {
        const store = backend.store(revisionId);
        return {
          insert: (s, e) => store.insert(s, e),
          remove: (s, e) => store.remove(s, e),
          update: async (table, id, base, next) => {
            // Moving a step doesn't count: race a field you typed or picked.
            const [field, mine] = Object.entries(next).find(([f]) => f !== "x" && f !== "y") ?? [];
            if (this.racing && this.channel && field !== undefined && mine !== undefined && field in base) {
              const theirs = rival(mine);
              if (theirs !== null) {
                this.racing = false;
                await this.save(revisionId, table, id, field, base[field]!, theirs);
              }
            }
            return store.update(table, id, base, next);
          },
        };
      },
    };
  }

  private async draft(): Promise<string | null> {
    const r = await this.backend.open();
    if (r.status !== "ok") return null;
    if (r.created) this.channel?.send({ kind: "draft", by: COLLEAGUE, event: "opened", revisionId: r.revision.id });
    return r.revision.id;
  }

  private async save(revisionId: string, table: Table, id: string, field: string, base: Value, value: Value): Promise<void> {
    const r = await this.backend.store(revisionId).update(table, id, { [field]: base }, { [field]: value });
    if (r.status === "saved" || r.status === "conflict") {
      const values: Patch = r.status === "conflict" && field in r.theirs ? {} : { [field]: value };
      if (Object.keys(values).length) this.channel?.send({ kind: "saved", by: COLLEAGUE, table, id, values });
    }
  }
}

/** A different value of the same kind, for Tom to race with. */
function rival(v: Value): Value {
  if (typeof v === "number") return sameScalar(v, 0) ? 1 : Math.round(v * 1.5 * 100) / 100 + 1;
  if (typeof v === "string") return `${v} (Tom's version)`;
  return null;
}

/** The step a demo colleague would pick first: the one you have selected, if any. */
export function preferredStep(bundle: ProcessBundle, selected: string[]): StepRow | undefined {
  return selected.length === 1 ? bundle.steps.find((s) => s.id === selected[0]) : undefined;
}
