import "server-only";
import { loadFirstPrinciplesFor, type ResolvedFirstPrinciples } from "@transpera-flow/db";
import { createClient } from "../supabase/server";

/**
 * The first principles of some revisions of a process (RLS: every member reads), each its own row or the nearest
 * earlier one. If they can't be read (say the table isn't there yet) every revision reads as "not started" rather
 * than breaking the page.
 */
export async function loadProcessFirstPrinciples(processId: string, revisionIds: readonly string[]): Promise<Record<string, ResolvedFirstPrinciples>> {
  try {
    return await loadFirstPrinciplesFor(await createClient(), processId, revisionIds);
  } catch (err) {
    console.error("Couldn't load the first principles; showing none.", err instanceof Error ? err.message : err);
    return Object.fromEntries(revisionIds.map((id) => [id, { doc: null, version: null, inheritedFrom: null }]));
  }
}
