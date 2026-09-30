// The robustness cache in the database (docs/PRD.md §5 `robustness_results`,
// §6.5 "Cached by (model hash, scenario hash, parameter, perturbation)"; issue
// #28). The engine's check is synchronous and reads a Map-like cache job by
// job, so this loads every job a report could reuse before it runs (one query
// per workspace, by check key), serves them from memory, and writes the new
// ones afterwards. A check cut short by the time cap keeps what it ran, so the
// next report resumes where it stopped.

import type { Db, Json } from "@transpera-flow/db";
import {
  ROBUSTNESS_VERSION,
  hashString,
  stableStringify,
  type ChunkResult,
  type EngineModel,
  type RobustnessCache,
  type ScenarioPatch,
} from "@transpera-flow/engine";

/** The prefix every job key of one check shares: version, model hash, scenario hash (engine `robustnessJobKey`). */
export function robustnessCheckKey(model: EngineModel, scenario: readonly ScenarioPatch[]): string {
  return [`v${ROBUSTNESS_VERSION}`, hashString(stableStringify(model)), hashString(stableStringify(scenario))].join("|");
}

/** A cache that remembers what was added, so it can be saved. */
export class RecordingCache implements RobustnessCache {
  private readonly map = new Map<string, ChunkResult>();
  readonly added = new Map<string, ChunkResult>();

  constructor(initial: Iterable<[string, ChunkResult]> = []) {
    for (const [k, v] of initial) this.map.set(k, v);
  }

  get(key: string) {
    return this.map.get(key);
  }

  set(key: string, value: ChunkResult) {
    if (!this.map.has(key)) this.added.set(key, value);
    this.map.set(key, value);
  }

  get size() {
    return this.map.size;
  }
}

const checkKeyOf = (cacheKey: string) => cacheKey.split("|").slice(0, 3).join("|");

/** Every cached job of these checks, as the signed-in user (RLS: anyone in the workspace reads). */
export async function loadRobustnessCache(db: Db, workspaceId: string, checkKeys: readonly string[]): Promise<RecordingCache> {
  const keys = [...new Set(checkKeys)];
  if (!keys.length) return new RecordingCache();
  const entries: [string, ChunkResult][] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("robustness_results")
      .select("cache_key, results")
      .eq("workspace_id", workspaceId)
      .in("check_key", keys)
      .order("cache_key")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) entries.push([row.cache_key, row.results as unknown as ChunkResult]);
    if (!data || data.length < PAGE) break;
  }
  return new RecordingCache(entries);
}

/** Save the jobs a check ran (editors; duplicates from a concurrent report are ignored). */
export async function saveRobustnessCache(db: Db, workspaceId: string, runId: string | null, cache: RecordingCache): Promise<number> {
  const rows = [...cache.added].map(([cache_key, results]) => ({
    workspace_id: workspaceId,
    run_id: runId,
    check_key: checkKeyOf(cache_key),
    cache_key,
    results: results as unknown as Json,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("robustness_results").upsert(rows.slice(i, i + 200), { onConflict: "workspace_id,cache_key", ignoreDuplicates: true });
    if (error) throw error;
  }
  return rows.length;
}
