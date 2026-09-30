"use server";

import type { RunResults } from "@transpera-flow/db";
import type { ExplanationView } from "@/components/narration";
import { demoExplanation } from "@/lib/narration/demo";

// "Explain this run" on the demo (issue #29): the stand-in writer, checked
// against the run's figures like Claude's text. Runs saved on /demo live in
// the tab, so the browser sends the results; nothing is stored or billed.

const isStat = (v: unknown) =>
  !!v && typeof v === "object" && ["mean", "p10", "p90"].every((k) => typeof (v as Record<string, unknown>)[k] === "number");

export async function explainDemoRun(
  run: { id: string; name: string; created_at: string; results: RunResults },
  processName: string,
): Promise<{ status: "ok"; narration: ExplanationView } | { status: "error"; message: string }> {
  const r = run?.results;
  if (!r || !["won", "lost", "mrr_added", "billed", "overtime_hours"].every((k) => isStat((r as Record<string, unknown>)[k])) || typeof r.horizon_weeks !== "number") {
    return { status: "error", message: "That run can't be explained." };
  }
  const n = await demoExplanation(run, String(processName).slice(0, 200));
  return {
    status: "ok",
    narration: { source: n.source, paragraphs: n.paragraphs, fallback: n.fallback, reason: n.reason, cached: false, model: n.model, checked: n.checked, retried: n.rejected.length > 0 },
  };
}
