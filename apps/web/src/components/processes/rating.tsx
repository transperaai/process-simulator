import { RATING_LABELS, type Rating } from "@transpera-flow/engine";
import { RATING_STYLE } from "@/lib/map/rating";

/** A small round dot in a rating's colour (grey when there is none): the process switcher's marker. */
export function RatingDot({ rating }: { rating: Rating | null }) {
  return <span aria-hidden data-rating={rating ?? "none"} className="size-2 shrink-0 rounded-full" style={{ background: rating ? RATING_STYLE[rating].stripe : "var(--line-2)" }} />;
}

/** A rating as a dot and its plain name, tinted like the map. */
export function RatingPill({ rating }: { rating: Rating | null }) {
  if (!rating) return <span className="text-xs whitespace-nowrap text-muted-foreground">Not rated</span>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs whitespace-nowrap"
      style={{ background: RATING_STYLE[rating].soft, borderColor: RATING_STYLE[rating].stripe }}
    >
      <RatingDot rating={rating} />
      {RATING_LABELS[rating]}
    </span>
  );
}
