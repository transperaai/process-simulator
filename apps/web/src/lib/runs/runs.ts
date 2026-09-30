// Saved runs in the app (issue #25; docs/PRD.md §4.1, D19). Framework-free:
// what saving sends, checking it on the server, and the default name.

import type { RunResults } from "@transpera-flow/db";

/** What the process page sends to save the run it shows. */
export interface SaveRunInput {
  name: string;
  processId: string;
  /** The live revision the run used; saving is refused if it's no longer live. */
  revisionId: string;
  results: RunResults;
  seed: number;
  reps: number;
  durationMs: number | null;
}

export type SaveRunResult = { status: "ok"; id: string } | { status: "error"; message: string };

export interface RunSaver {
  save(input: SaveRunInput): Promise<SaveRunResult>;
}

export const MAX_RUN_NAME = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStat = (v: unknown): boolean =>
  !!v && typeof v === "object" && ["mean", "p10", "p90"].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/** "Run 30 Sep 2026, 14:05". */
export function defaultRunName(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `Run ${day}, ${time}`;
}

/** The input, checked, or why it isn't valid. */
export function parseSaveRun(input: unknown): { ok: true; value: SaveRunInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Nothing to save." };
  const i = input as Record<string, unknown>;
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (!name || name.length > MAX_RUN_NAME) return { ok: false, message: `Give the run a name of at most ${MAX_RUN_NAME} characters.` };
  if (typeof i.processId !== "string" || !UUID.test(i.processId) || typeof i.revisionId !== "string" || !UUID.test(i.revisionId)) {
    return { ok: false, message: "That run isn't of a saved process." };
  }
  const r = i.results as Record<string, unknown> | null;
  const statsOk =
    !!r &&
    typeof r === "object" &&
    ["won", "lost", "mrr_added", "billed", "overtime_hours"].every((k) => isStat(r[k])) &&
    Number.isFinite(r.horizon_weeks) &&
    Number.isFinite(r.reps) &&
    JSON.stringify(r).length < 100_000;
  if (!statsOk) return { ok: false, message: "The run's results aren't complete." };
  if (!Number.isInteger(i.seed) || !Number.isInteger(i.reps) || (i.reps as number) < 1) return { ok: false, message: "The run's settings aren't valid." };
  const durationMs = Number.isFinite(i.durationMs) ? Math.round(i.durationMs as number) : null;
  return {
    ok: true,
    value: {
      name,
      processId: i.processId,
      revisionId: i.revisionId,
      results: r as unknown as RunResults,
      seed: i.seed as number,
      reps: i.reps as number,
      durationMs,
    },
  };
}
