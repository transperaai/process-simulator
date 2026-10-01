"use client";

// The Overview's two trend charts (issue #100, A35), drawn by hand in SVG and CSS from the theme's tokens: no
// chart library is in the app. Each says what it shows in words for a screen reader, and carries the same numbers
// in a table only a screen reader sees. Colours come from the tokens (`--accent`, `--chart-*`, the rating colours),
// so both themes work, and no meaning rests on colour alone: values are written next to the marks.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { labelIndexes, monthLabel, niceTicks } from "@/lib/overview/axis";
import type { MrrPoint, RoleBusy } from "@/lib/overview/projection";

/** The width of an element, following it as it resizes (0 until it is measured). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const MRR_HEIGHT = 244;

/** Monthly recurring revenue: the average as a line, and the 10-90% range of the 30 runs as a band behind it. */
export function MrrChart({ points, horizonMonths, currency }: { points: MrrPoint[]; horizonMonths: number; currency: string }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = measured || 560;
  const compact = width < 480;
  const m = { l: compact ? 52 : 62, r: compact ? 58 : 72, t: 14, b: 30 };
  const lows = points.map((p) => p.lo);
  const highs = points.map((p) => p.hi);
  const ticks = niceTicks(Math.min(...lows), Math.max(...highs));
  const y0 = ticks[0]!;
  const y1 = ticks[ticks.length - 1]!;
  const x = (i: number) => m.l + (points.length > 1 ? (i / (points.length - 1)) * (width - m.l - m.r) : 0);
  const y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (MRR_HEIGHT - m.t - m.b);
  const money = (v: number) => formatCurrency(v, currency);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join(" ");
  const band = `${points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.hi).toFixed(1)}`).join(" ")} ${[...points]
    .map((p, i) => `L${x(i).toFixed(1)},${y(p.lo).toFixed(1)}`)
    .reverse()
    .join(" ")} Z`;
  const last = points[points.length - 1]!;
  const labelled = new Set(labelIndexes(points.length, Math.max(2, Math.floor((width - m.l - m.r) / 72) + 1)));
  const shown = hover !== null ? points[hover] : null;
  const pointerMove = (clientX: number, left: number) => {
    const px = clientX - left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={MRR_HEIGHT}
        role="img"
        aria-label={`Monthly recurring revenue, from ${money(points[0]!.mean)} now to ${money(last.mean)} after ${monthLabel(last.month, horizonMonths).toLowerCase()}, with a range of ${money(last.lo)} to ${money(last.hi)}.`}
        className="block overflow-visible"
        onPointerMove={(e) => pointerMove(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="fill-fg-3 text-[11px] tabular-nums">
              {money(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          labelled.has(i) ? (
            <text key={p.month} x={x(i)} y={MRR_HEIGHT - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-fg-3 text-[11px]">
              {monthLabel(p.month, horizonMonths)}
            </text>
          ) : null,
        )}
        <path d={band} fill="var(--accent)" fillOpacity={0.16} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {points.length <= 8 && points.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.mean)} r={3} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} />)}
        <circle cx={x(points.length - 1)} cy={y(last.mean)} r={4.5} fill="var(--accent)" />
        <text x={x(points.length - 1) + 9} y={y(last.mean) + 4} className="fill-fg text-[12px] font-semibold tabular-nums">
          {money(last.mean)}
        </text>
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={MRR_HEIGHT - m.b} stroke="var(--fg-3)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover]!.mean)} r={5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {shown && hover !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute top-1 z-10 w-max max-w-48 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 150)) }}
        >
          <p className="font-medium">{monthLabel(shown.month, horizonMonths)}</p>
          <p className="tabular-nums">{money(shown.mean)} on average</p>
          {shown.month > 0 && (
            <p className="text-muted-foreground tabular-nums">
              {money(shown.lo)} to {money(shown.hi)}
            </p>
          )}
        </div>
      )}
      <table className="sr-only">
        <caption>Monthly recurring revenue, average and 10 to 90 percent range</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Average</th>
            <th scope="col">Low (10%)</th>
            <th scope="col">High (90%)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{monthLabel(p.month, horizonMonths)}</th>
              <td>{money(p.mean)}</td>
              <td>{money(p.lo)}</td>
              <td>{money(p.hi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How busy each role is: a bar to the average, a whisker for the 10-90% range, and a dashed line where "too busy" starts. */
export function RoleBusyChart({ roles, busyLine }: { roles: RoleBusy[]; busyLine: number }) {
  const top = Math.max(1.1, busyLine + 0.15, ...roles.map((r) => r.hi * 1.05));
  const at = (v: number) => `${(Math.min(v, top) / top) * 100}%`;
  const tone = (v: number) => (v >= 0.95 ? "var(--rate-risk)" : v >= busyLine ? "var(--rate-bad)" : "var(--accent)");
  return (
    <div>
      <ul className="flex flex-col" aria-label="How busy each role is">
        {roles.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(6.5rem,9.5rem)_minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(6.5rem,9.5rem)_minmax(0,1fr)_9.5rem] items-center gap-x-3 py-1.5 text-sm">
            <span className="truncate" title={r.name}>
              {r.name}
            </span>
            <span className="relative h-5">
              <span className="absolute inset-y-0 left-0 right-0 rounded-sm bg-muted/60" />
              <span className="absolute top-1/2 left-0 h-3 -translate-y-1/2 rounded-sm" style={{ width: at(r.mean), minWidth: 2, background: tone(r.mean) }} />
              <span className="absolute top-1/2 h-px -translate-y-1/2 bg-fg-2" style={{ left: at(r.lo), width: `calc(${at(r.hi)} - ${at(r.lo)})` }} />
              <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-fg-2" style={{ left: at(r.lo) }} />
              <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-fg-2" style={{ left: at(r.hi) }} />
              <span aria-hidden className="absolute inset-y-0 w-0 border-l border-dashed border-fg-3" style={{ left: at(busyLine) }} />
            </span>
            <span className="text-right tabular-nums">
              <b className="font-semibold">{formatPercent(r.mean)}</b>
              <span className="sr-only ml-1 text-xs text-muted-foreground sm:not-sr-only sm:inline">
                {formatPercent(r.lo)}–{formatPercent(r.hi)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(6.5rem,9.5rem)_minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(6.5rem,9.5rem)_minmax(0,1fr)_9.5rem] gap-x-3 text-[11px] text-muted-foreground">
        <span />
        <span className="relative h-4">
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at(busyLine) }}>
            {formatPercent(busyLine)} line
          </span>
        </span>
        <span />
      </div>
    </div>
  );
}

/** A legend entry: a swatch and a word. */
export function LegendItem({ children, swatch }: { children: ReactNode; swatch: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {children}
    </span>
  );
}
