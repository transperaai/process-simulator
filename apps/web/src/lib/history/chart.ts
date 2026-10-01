// The history charts' geometry (issue #105): a line for the average with a band for the range, one point per
// version, oldest on the left. A version that hasn't been simulated is a gap, not a zero. Pure, so it is tested
// without drawing anything.

import type { Measure } from "./versions";

export interface ChartInput {
  label: string;
  /** Null while the version has no numbers (not run, running, or failed). */
  measure: Measure | null;
}

export interface ChartSize {
  width: number;
  height: number;
  /** Space kept around the plot for the axes. */
  pad: { top: number; right: number; bottom: number; left: number };
}

export interface ChartPoint {
  label: string;
  x: number;
  mean: number;
  lo: number;
  hi: number;
  yMean: number;
  yLo: number;
  yHi: number;
}

export interface ChartGeometry {
  /** Points of the versions that have numbers, in order. */
  points: ChartPoint[];
  /** One path per unbroken stretch of versions with numbers, for the average. */
  lines: string[];
  /** One closed path per unbroken stretch, for the range. */
  bands: string[];
  /** Gridlines: the value and where it sits. */
  ticks: { value: number; y: number }[];
  /** Where each version's label sits, including versions without numbers. */
  labels: { label: string; x: number }[];
  max: number;
}

/** A tidy top for the axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

const r = (n: number) => Math.round(n * 10) / 10;

export function chartGeometry(input: readonly ChartInput[], size: ChartSize): ChartGeometry {
  const { width, height, pad } = size;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const highest = Math.max(0, ...input.flatMap((i) => (i.measure ? [i.measure.hi, i.measure.mean] : [])));
  const max = niceMax(highest * 1.05);
  const x = (i: number) => pad.left + (input.length <= 1 ? plotW / 2 : (plotW * i) / (input.length - 1));
  const y = (v: number) => pad.top + plotH - (Math.min(Math.max(v, 0), max) / max) * plotH;

  const runs: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  const points: ChartPoint[] = [];
  input.forEach((item, i) => {
    if (!item.measure) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    const m = item.measure;
    const p: ChartPoint = { label: item.label, x: x(i), mean: m.mean, lo: m.lo, hi: m.hi, yMean: y(m.mean), yLo: y(m.lo), yHi: y(m.hi) };
    points.push(p);
    current.push(p);
  });
  if (current.length) runs.push(current);

  const lines = runs.filter((run) => run.length > 1).map((run) => run.map((p, i) => `${i ? "L" : "M"}${r(p.x)} ${r(p.yMean)}`).join(" "));
  const bands = runs
    .filter((run) => run.length > 1)
    .map((run) => `${run.map((p, i) => `${i ? "L" : "M"}${r(p.x)} ${r(p.yHi)}`).join(" ")} ${[...run].reverse().map((p) => `L${r(p.x)} ${r(p.yLo)}`).join(" ")} Z`);

  const ticks = [0, 0.5, 1].map((f) => ({ value: max * f, y: y(max * f) }));
  return { points, lines, bands, ticks, labels: input.map((item, i) => ({ label: item.label, x: x(i) })), max };
}
