"use client";

// Controls and legend for the process map (issue #99): zoom -, Fit, +, and the four
// rating colours (plus the red badge) with their plain names.

import { RATING_LABELS } from "@transpera-flow/engine";
import { LEGEND_ORDER, RATING_STYLE } from "@/lib/map/rating";
import { zoomLabel } from "@/lib/map/zoom";

const button =
  "min-w-8 px-2 py-1 text-fg hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-fg-3 disabled:hover:bg-transparent focus-visible:relative focus-visible:z-10";

export function ZoomControls({
  zoom,
  onOut,
  onFit,
  onIn,
  canOut = true,
  canIn = true,
}: {
  zoom: number;
  onOut: () => void;
  onFit: () => void;
  onIn: () => void;
  /** False at the smallest or largest zoom, where the button does nothing. */
  canOut?: boolean;
  canIn?: boolean;
}) {
  return (
    <div role="group" aria-label="Zoom" className="flex items-stretch divide-x divide-line overflow-hidden rounded-token border border-line bg-panel text-xs">
      <button type="button" onClick={onOut} disabled={!canOut} aria-label="Zoom out" title="Zoom out" className={button}>
        −
      </button>
      <button type="button" onClick={onFit} title="Fit the map to this panel (never smaller than 70%)" className={`${button} font-semibold`}>
        Fit
      </button>
      <button type="button" onClick={onIn} disabled={!canIn} aria-label="Zoom in" title="Zoom in" className={button}>
        +
      </button>
      <span className="px-2 py-1 font-mono text-[11px] text-fg-2 tabular-nums" aria-live="polite" title="Current zoom">
        {zoomLabel(zoom)}
      </span>
    </div>
  );
}

/** Short names for narrow screens; the full ones are what a screen reader and a wide screen get. */
const SHORT = { risk: "Risk", bad: "Bad", good: "Good", great: "Great" } as const;

function Item({ color, full, short, title, round = false }: { color: string; full: string; short: string; title: string; round?: boolean }) {
  return (
    <li className="inline-flex items-center gap-1.5" title={title}>
      <i aria-hidden className={`size-2.5 ${round ? "rounded-full" : "rounded-[3px]"}`} style={{ background: color }} />
      <span className="sr-only sm:not-sr-only">{full}</span>
      <span aria-hidden className="sm:hidden">
        {short}
      </span>
    </li>
  );
}

/** What the colours on the map mean. `badge`: the red count of confirmed issues is shown too. */
export function MapLegend({ badge }: { badge: boolean }) {
  return (
    <ul aria-label="Map colours" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-2">
      {LEGEND_ORDER.map((r) => (
        <Item key={r} color={RATING_STYLE[r].stripe} full={RATING_LABELS[r]} short={SHORT[r]} title={RATING_STYLE[r].hint} />
      ))}
      <Item color="var(--line-2)" full="No confirmed issues" short="None" title="Steps with no confirmed issue are not coloured: insights stay off the map until someone acknowledges them." />
      {badge && (
        <Item
          color="var(--crit)"
          round
          full="Confirmed issues"
          short="Issues"
          title="The red number on a step is its confirmed issues. Insights nobody has acknowledged yet are not counted."
        />
      )}
    </ul>
  );
}
