// What a person can do with an insight (issue #110): acknowledge it into a tracked issue, or dismiss it. Both go through
// the issue store the page already has. `acknowledgeInsight` is the one place the Acknowledge button calls: A47 swaps
// the full dialog in behind it.

import type { IssueRow, ScenarioRow } from "@transpera-flow/db";
import { promoteInput } from "@/lib/issues/register";
import type { IssuesState } from "@/lib/issues/use-issues";
import type { Insight } from "./insights";

export interface InsightContext {
  /** The process the issue is logged against when the insight's step doesn't say (the page's own process). */
  processId: string | null;
  /** The process a step belongs to, when the page shows several (the Overview). */
  processOfStep?: (stepId: string) => string | null | undefined;
  scenarios: readonly ScenarioRow[];
}

const processFor = (i: Insight, ctx: InsightContext): string | null => (i.stepIds[0] ? ctx.processOfStep?.(i.stepIds[0]) : null) ?? ctx.processId;

/** Turn an insight into a tracked issue. For now it is saved straight away; A47 puts its dialog in front of this. */
export function acknowledgeInsight(state: Pick<IssuesState, "promote">, insight: Insight, ctx: InsightContext): Promise<IssueRow | null> {
  return state.promote(promoteInput(insight.detection, processFor(insight, ctx), ctx.scenarios));
}

/** Dismiss an insight: it is tracked as dismissed, so it stays off the list and the map and doesn't come back next run. */
export async function dismissInsight(state: Pick<IssuesState, "promote" | "saver">, insight: Insight, ctx: InsightContext): Promise<boolean> {
  const row = await acknowledgeInsight(state, insight, ctx);
  if (!row) return false;
  const outcome = await state.saver(row.id, "status")("open", "dismissed");
  return outcome.status === "saved";
}
