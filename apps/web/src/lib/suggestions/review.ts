// Reviewing company-model suggestions (issue #25; docs/PRD.md §7.1c, D19).
// Framework-free: the Suggestions page talks to a `SuggestionBackend`, either
// Server Actions that call `review_suggestions` as the signed-in user, or
// `reviewInMemory` on the public demo. Both answer with a result per
// suggestion and the suggestions and company model as they now are.

import {
  applySuggestion,
  SuggestionError,
  type CompanyModel,
  type SuggestionApplied,
  type SuggestionRow,
} from "@transpera-flow/db";

export type ReviewDecision = "accept" | "reject";
export type ReviewStatus = "accepted" | "rejected" | "not_found" | "already_reviewed" | "failed";

/** What happened to one suggestion (the shape `public.review_suggestions` returns). */
export interface ReviewResult {
  id: string;
  status: ReviewStatus;
  message?: string;
  applied?: SuggestionApplied;
}

export type ReviewOutcome =
  | { status: "ok"; results: ReviewResult[]; suggestions: SuggestionRow[]; model: CompanyModel }
  | { status: "error"; message: string };

export interface SuggestionBackend {
  review(ids: string[], decision: ReviewDecision, note: string | null): Promise<ReviewOutcome>;
}

export const MAX_REVIEW = 500;
export const MAX_REVIEW_NOTE = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checked review input, or why it isn't valid. */
export function parseReview(
  ids: unknown,
  decision: unknown,
  note: unknown,
): { ok: true; ids: string[]; decision: ReviewDecision; note: string | null } | { ok: false; message: string } {
  if (decision !== "accept" && decision !== "reject") return { ok: false, message: "Choose accept or reject." };
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_REVIEW || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, message: `Choose between 1 and ${MAX_REVIEW} suggestions.` };
  }
  if (note !== null && note !== undefined && (typeof note !== "string" || note.length > MAX_REVIEW_NOTE)) {
    return { ok: false, message: `A reason can be at most ${MAX_REVIEW_NOTE} characters.` };
  }
  const clean = typeof note === "string" ? note.trim() || null : null;
  return { ok: true, ids: [...new Set(ids as string[])], decision, note: clean };
}

/** One line for the page after a review: "Accepted 3. 1 couldn't be applied: …". */
export function reviewSummary(results: readonly ReviewResult[], decision: ReviewDecision): string {
  const done = results.filter((r) => r.status === (decision === "accept" ? "accepted" : "rejected")).length;
  const failed = results.filter((r) => r.status === "failed");
  const gone = results.filter((r) => r.status === "not_found").length;
  const already = results.filter((r) => r.status === "already_reviewed").length;
  const parts: string[] = [];
  if (done) parts.push(`${decision === "accept" ? "Accepted" : "Rejected"} ${done}.`);
  if (failed.length) {
    parts.push(
      `${failed.length} couldn't be ${decision === "accept" ? "applied" : "rejected"} and ${failed.length === 1 ? "is" : "are"} still pending: ${[
        ...new Set(failed.map((f) => f.message ?? "unknown error")),
      ].join("; ")}.`,
    );
  }
  if (already) parts.push(`${already} had already been reviewed.`);
  if (gone) parts.push(`${gone} ${gone === 1 ? "isn't" : "aren't"} yours to review (or no longer exist${gone === 1 ? "s" : ""}).`);
  return parts.join(" ") || "Nothing to review.";
}

export interface MemoryReviewOptions {
  at: string;
  by: string | null;
  newId: () => string;
}

/**
 * Review suggestions in memory, as the database does: each on its own, a
 * failure leaving that one pending and the rest going through.
 */
export function reviewInMemory(
  state: { model: CompanyModel; suggestions: readonly SuggestionRow[] },
  ids: readonly string[],
  decision: ReviewDecision,
  note: string | null,
  opts: MemoryReviewOptions,
): { model: CompanyModel; suggestions: SuggestionRow[]; results: ReviewResult[] } {
  let model = state.model;
  let suggestions = [...state.suggestions];
  const results: ReviewResult[] = [];
  for (const id of ids) {
    const s = suggestions.find((x) => x.id === id);
    if (!s) {
      results.push({ id, status: "not_found" });
      continue;
    }
    if (s.status !== "pending") {
      results.push({ id, status: "already_reviewed" });
      continue;
    }
    let applied: SuggestionApplied | null = null;
    if (decision === "accept") {
      try {
        const next = applySuggestion(model, s, opts);
        model = next.model;
        applied = next.applied;
      } catch (err) {
        if (!(err instanceof SuggestionError)) throw err;
        results.push({ id, status: "failed", message: err.message });
        continue;
      }
    }
    const status = decision === "accept" ? "accepted" : "rejected";
    const reviewed: SuggestionRow = { ...s, status, applied, review_note: note, reviewed_by: opts.by, reviewed_at: opts.at };
    suggestions = suggestions.map((x) => (x.id === id ? reviewed : x));
    results.push(applied ? { id, status, applied } : { id, status });
  }
  return { model, suggestions, results };
}
