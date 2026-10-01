// Zoom on the process map (issue #99). A small map is fitted to its panel; a big
// one is never shrunk below 70%, so its text stays readable, and the panel scrolls
// (pans) instead. Pure, so the calculation is tested without a browser.

export interface Box {
  width: number;
  height: number;
}

/** Fitting never goes below this: text stays readable and the map scrolls instead. */
export const MIN_FIT_ZOOM = 0.7;
/** Fitting never blows a small map up past this. */
export const MAX_FIT_ZOOM = 1.15;
/** The - and + buttons stay between these. */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 1.8;
export const ZOOM_STEP = 0.15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The zoom that fits `content` in `panel` (both in pixels), kept between 70% and 115%. */
export function fitZoom(content: Box, panel: Box): number {
  if (content.width <= 0 || content.height <= 0 || panel.width <= 0 || panel.height <= 0) return 1;
  return clamp(Math.min(panel.width / content.width, panel.height / content.height), MIN_FIT_ZOOM, MAX_FIT_ZOOM);
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Where to put the map so `bounds` (in map units) is framed in `panel`: fitted (see `fitZoom`) and centred when it
 * fits, or, when it is bigger than the panel at 70%, pinned to the top left so the rest is a scroll (drag) away.
 */
export function fitViewport(bounds: { x: number; y: number; width: number; height: number }, panel: Box, pad: Padding = NO_PADDING): { x: number; y: number; zoom: number } {
  const room: Box = { width: panel.width - pad.left - pad.right, height: panel.height - pad.top - pad.bottom };
  const zoom = fitZoom(bounds, room);
  const place = (start: number, size: number, room: number, before: number) =>
    size * zoom <= room ? before + (room - size * zoom) / 2 - start * zoom : before - start * zoom;
  return {
    x: place(bounds.x, bounds.width, room.width, pad.left),
    y: place(bounds.y, bounds.height, room.height, pad.top),
    zoom,
  };
}

/** The next zoom after a click on - or +. */
export function stepZoom(zoom: number, direction: "in" | "out"): number {
  const next = zoom + (direction === "in" ? ZOOM_STEP : -ZOOM_STEP);
  return Math.round(clamp(next, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
}

/** "85%". */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`;
