"use client";

// Controls and legend for the process map (issue #99): zoom -, Fit, +, and the four
// rating colours (plus the red badge) with their plain names.

import { RATING_LABELS } from "@transpera-flow/engine";
import { LEGEND_ORDER, RATING_STYLE } from "@/lib/map/rating";
import { zoomLabel } from "@/lib/map/zoom";

const button =
  "min-w-8 px-2 py-1 text-fg hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-fg-3 disabled:hover:bg-panel focus-visible:relative focus-visible:z-10";

export function ZoomControls({ zoom, onOut, onFit, onIn }: { zoom: number; onOut: () => void; onFit: () => void; onIn: () => void }) {
  return (
    <div role="group" aria-label="Zoom" className="flex items-stretch divide-x divide-line overflow-hidden rounded-token border border-line bg-panel/95 text-xs shadow-token">
      <button type="button" onClick={onOut} aria-label="Zoom out" title="Zoom out" className={button}>
        −
      </button>
      <button type="button" onClick={onFit} title="Fit the map to this panel (never smaller than 70%)" className={`${button} font-semibold`}>
        Fit
      </button>
      <button type="button" onClick={onIn} aria-label="Zoom in" title="Zoom in" className={button}>
        +
      </button>
      <span className="px-2 py-1 font-mono text-[11px] text-fg-3 tabular-nums" aria-live="polite" title="Current zoom">
        {zoomLabel(zoom)}
      </span>
    </div>
  );
}

/** What the colours on the map mean. `badge`: the red count of confirmed issues is shown too. */
export function MapLegend({ badge }: { badge: boolean }) {
  return (
    <ul aria-label="Map colours" className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-[11.5px] text-fg-2">
      {LEGEND_ORDER.map((r) => (
        <li key={r} className="inline-flex items-center gap-1.5" title={RATING_STYLE[r].hint}>
          <i aria-hidden className="size-2.5 rounded-[3px]" style={{ background: RATING_STYLE[r].stripe }} />
          {RATING_LABELS[r]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5" title="Steps nobody has rated yet">
        <i aria-hidden className="size-2.5 rounded-[3px] bg-line-2" />
        Not rated
      </li>
      {badge && (
        <li className="inline-flex items-center gap-1.5" title="The number of confirmed issues on a step. Insights nobody has acknowledged yet are not counted.">
          <i aria-hidden className="size-2.5 rounded-full bg-crit" />
          Confirmed issues
        </li>
      )}
    </ul>
  );
}
