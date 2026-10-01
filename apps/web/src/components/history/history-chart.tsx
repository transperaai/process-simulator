import type { ReactNode } from "react";
import { chartGeometry, type ChartInput } from "@/lib/history/chart";

const SIZE = { width: 560, height: 190, pad: { top: 12, right: 14, bottom: 26, left: 40 } };

/**
 * One headline measure by version (issue #105): a line through the averages and a band for the range, oldest
 * version on the left. A version with no numbers yet is a gap. Drawn as plain SVG in the theme's colours; the
 * numbers are in the table below, and each point carries them as a tooltip.
 */
export function HistoryChart({
  title,
  help,
  unit,
  data,
  format,
  pending,
}: {
  title: string;
  /** The (i) beside the title. */
  help: ReactNode;
  /** What the axis counts, for the screen-reader summary: "wins per month", "days". */
  unit: string;
  data: ChartInput[];
  format: (value: number) => string;
  /** Versions still being simulated. */
  pending: number;
}) {
  const g = chartGeometry(data, SIZE);
  const summary = g.points.length
    ? `${title}. ${g.points.map((p) => `${p.label}: ${format(p.mean)} ${unit}, range ${format(p.lo)} to ${format(p.hi)}`).join("; ")}.`
    : `${title}. No numbers yet.`;
  return (
    <figure className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-chart={title}>
      <figcaption className="flex items-center text-sm font-semibold">
        {title}
        {help}
      </figcaption>
      <svg viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img" aria-label={summary} className="h-auto w-full">
        {g.ticks.map((t) => (
          <g key={t.value}>
            <line x1={SIZE.pad.left} x2={SIZE.width - SIZE.pad.right} y1={t.y} y2={t.y} className="stroke-border" strokeWidth={1} />
            <text x={SIZE.pad.left - 6} y={t.y + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {format(t.value)}
            </text>
          </g>
        ))}
        {g.bands.map((d) => (
          <path key={d} d={d} className="fill-accent/15" />
        ))}
        {g.lines.map((d) => (
          <path key={d} d={d} className="fill-none stroke-accent" strokeWidth={2} strokeLinejoin="round" />
        ))}
        {g.points.map((p) => (
          <g key={p.label}>
            <line x1={p.x} x2={p.x} y1={p.yHi} y2={p.yLo} className="stroke-accent/50" strokeWidth={1.5} />
            <circle cx={p.x} cy={p.yMean} r={3.5} className="fill-accent stroke-card" strokeWidth={1.5}>
              <title>{`${p.label}: ${format(p.mean)} ${unit} (range ${format(p.lo)} to ${format(p.hi)})`}</title>
            </circle>
          </g>
        ))}
        {g.labels.map((l, i) => (
          // With many versions, label about every other one so the labels don't run together.
          <text key={l.label} x={l.x} y={SIZE.height - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]" opacity={g.labels.length > 12 && i % 2 ? 0 : 1}>
            {l.label}
          </text>
        ))}
      </svg>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {pending > 0 ? `Simulating ${pending} version${pending === 1 ? "" : "s"}…` : g.points.length ? "The line is the average; the shaded band is the range." : "Run a version to see it here."}
      </p>
    </figure>
  );
}
