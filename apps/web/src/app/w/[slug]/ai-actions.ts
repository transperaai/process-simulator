"use server";

import { refresh } from "next/cache";
import { AI_NOT_SET_UP } from "@/lib/ai/types";
import { runAiAnalysis } from "@/lib/ai/service";
import { createClient } from "@/lib/supabase/server";

// "Run again" on the AI read (issue #111, A46). Runs as the signed-in user: the analysis is written under RLS, so a viewer's
// click writes nothing (and the button isn't shown to them). It waits for the model, so the page that calls it allows
// a long request (`maxDuration` on the Overview and the process page).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AiRunReply = { status: "ok"; message: string } | { status: "error"; message: string };

/** Run the AI analysis of a process's live version now, ignoring the usual gaps. */
export async function runAiAnalysisNow(processId: string): Promise<AiRunReply> {
  if (typeof processId !== "string" || !UUID.test(processId)) return { status: "error", message: "That isn't valid." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { status: "error", message: "Your session has ended. Sign in again." };
  const out = await runAiAnalysis(supabase, processId, { trigger: "manual", force: true });
  if (out.status === "error") return { status: "error", message: out.message };
  if (out.status === "skipped") {
    const message =
      out.why === "not_set_up"
        ? AI_NOT_SET_UP
        : out.why === "no_first_principles"
          ? "Write this process's first principles first, and publish them: the review judges the process against them."
          : out.why === "forbidden"
            ? "Only owners and editors can run the AI review."
            : out.why === "no_live"
              ? "Publish a version of this process first."
              : (out.message ?? "AI analysis didn't run.");
    return { status: "error", message };
  }
  refresh();
  const o = out.outcome;
  if (o.status === "unavailable") return { status: "error", message: o.reason ?? AI_NOT_SET_UP };
  if (o.status === "failed") return { status: "error", message: `AI couldn't write a review that matched the run: ${o.reason ?? "no reason given"}.` };
  return { status: "ok", message: o.insights.length ? `AI review done: ${o.insights.length} insight${o.insights.length === 1 ? "" : "s"}.` : "AI review done. No new insights." };
}
