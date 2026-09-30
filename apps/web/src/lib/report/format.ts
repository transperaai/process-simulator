// How the report prints numbers: the app's formatters (lib/format.ts), so the
// PDF says what the screens say, plus the range text under each figure.

import type { Stat } from "@transpera-flow/engine";
import { formatCurrency, formatDays, formatHours, formatNumber, formatPercent, formatRange } from "@/lib/format";
import type { FigureFormat } from "./content";

export interface FigureContext {
  currency: string;
  hoursPerWeek: number;
}

/** One value in a figure's format ("7.2", "£21k", "3.4 d", "96%"). */
export function formatFigure(format: FigureFormat, value: number, ctx: FigureContext): string {
  switch (format) {
    case "count":
      return formatNumber(value, 1);
    case "money":
      return formatCurrency(value, ctx.currency);
    case "days":
      return formatDays(value, ctx.hoursPerWeek);
    case "hours":
      return formatHours(value);
    case "percent":
      return formatPercent(value);
  }
}

/** "range 5–9": the 10th–90th percentile band in the figure's format. Counts print whole. */
export function figureRange(format: FigureFormat, stat: Stat, ctx: FigureContext): string {
  const fmt = format === "count" ? (v: number) => formatNumber(v, 0) : (v: number) => formatFigure(format, v, ctx);
  return formatRange(stat, fmt);
}

/** "avg 7.2 (range 5–9)": the report's figure-with-range form (docs/PRD.md §7.3). */
export function avgWithRange(format: FigureFormat, stat: Stat, ctx: FigureContext): string {
  return `avg ${formatFigure(format, stat.mean, ctx)} (${figureRange(format, stat, ctx)})`;
}

/** "30 Sep 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "30 Sep 2026, 14:05 UTC". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
