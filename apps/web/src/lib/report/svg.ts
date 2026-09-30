// The report's pictures as SVG strings (issue #28): each process map drawn
// from its saved layout (the canvas's own x/y, so it matches what people see
// in the app, not a screenshot), the company map, and the charts. Vector, so
// they stay sharp in the PDF at any zoom. Colours come from the report's CSS
// classes (tokens), except role colours, which are the workspace's own.

import type { Stat } from "@transpera-flow/engine";
import type { CompanyMapView, MapNode, ProcessMapView, UtilisationRow } from "./content";
import { esc, r1, safeColor } from "./html";

const TASK_W = 176;
const TASK_H = 84;
const TERM_H = 30;
const PAD = 24;
/** Canvas pixels to CSS pixels on the page: the Northbeam pipeline just fits the A4 width. */
const MAP_SCALE = 0.62;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const isTerminal = (n: MapNode) => n.kind === "start" || n.kind === "end";

function boxOf(n: MapNode): Box {
  if (isTerminal(n)) return { x: n.x, y: n.y, w: Math.max(64, n.name.length * 7 + 28), h: TERM_H };
  return { x: n.x, y: n.y, w: TASK_W, h: TASK_H };
}

/** Greedy word wrap by an estimated character width. */
export function wrap(text: string, maxChars: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

const hours = (h: number) => `${Math.round(h * 10) / 10} h`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Where an edge leaves one box and enters another, as an orthogonal path, with a point for its label. */
function edgePath(a: Box, b: Box): { d: string; lx: number; ly: number } {
  const sx = a.x + a.w;
  const sy = a.y + a.h / 2;
  const tx = b.x;
  const ty = b.y + b.h / 2;
  if (tx >= sx + 24) {
    const mx = (sx + tx) / 2;
    return { d: `M${r1(sx)} ${r1(sy)} H${r1(mx)} V${r1(ty)} H${r1(tx)}`, lx: mx, ly: (sy + ty) / 2 };
  }
  // Backwards or overlapping: out to the right, along a channel between the rows, then in from the left.
  const off = 14;
  const below = b.y > a.y + a.h ? (a.y + a.h + b.y) / 2 : b.y + b.h < a.y ? (b.y + b.h + a.y) / 2 : Math.max(a.y + a.h, b.y + b.h) + 18;
  return {
    d: `M${r1(sx)} ${r1(sy)} H${r1(sx + off)} V${r1(below)} H${r1(tx - off)} V${r1(ty)} H${r1(tx)}`,
    lx: (sx + tx) / 2,
    ly: below,
  };
}

/** A process map, as the canvas lays it out, with bottleneck callouts. */
export function processMapSvg(map: ProcessMapView): string {
  if (!map.nodes.length) return `<p class="muted">This process has no steps.</p>`;
  const boxes = new Map(map.nodes.map((n) => [n.id, boxOf(n)]));
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x)) - PAD;
  const minY = Math.min(...all.map((b) => b.y)) - PAD - 10;
  const maxX = Math.max(...all.map((b) => b.x + b.w)) + PAD;
  const maxY = Math.max(...all.map((b) => b.y + b.h)) + PAD + 24;
  const w = maxX - minX;
  const h = maxY - minY;
  const marker = `m-${map.id.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;

  const edges = map.edges
    .map((e) => {
      const a = boxes.get(e.from);
      const b = boxes.get(e.to);
      if (!a || !b) return "";
      const { d, lx, ly } = edgePath(a, b);
      const bits = [e.probability < 0.999 ? pct(e.probability) : null, e.tag, e.label].filter(Boolean) as string[];
      const label = bits.length
        ? `<text class="svg-edge-label" x="${r1(lx)}" y="${r1(ly - 4)}" text-anchor="middle">${esc(bits.join(" · "))}</text>`
        : "";
      return `<path class="svg-edge" d="${d}" marker-end="url(#${marker})"/>${label}`;
    })
    .join("");

  const nodes = map.nodes
    .map((n) => {
      const b = boxes.get(n.id)!;
      if (isTerminal(n)) {
        const tone = n.kind === "start" ? "svg-term-start" : n.outcome === "won" ? "svg-term-won" : n.outcome === "lost" ? "svg-term-lost" : "svg-term-done";
        return `<g><rect class="svg-term ${tone}" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${b.h}" rx="${b.h / 2}"/><text class="svg-term-text" x="${r1(b.x + b.w / 2)}" y="${r1(b.y + 19)}" text-anchor="middle">${esc(n.name)}</text></g>`;
      }
      const stripe = safeColor(n.role?.color, "#c2c6bf");
      const title = wrap(n.name, 24);
      const who = n.person ?? n.role?.name ?? (n.kind === "decision" ? "Decision" : n.kind === "wait" ? "Wait" : "No role");
      const times = [n.workHours ? `${hours(n.workHours)} work` : null, n.waitHours ? `${hours(n.waitHours)} wait` : null].filter(Boolean).join(" · ");
      const stats = n.stats && n.stats.arrivals > 0 ? `queue avg ${Math.round(n.stats.avgQueue * 10) / 10} · max ${Math.round(n.stats.maxQueue)}` : "";
      const lines = [
        ...title.map((t, i) => `<text class="svg-node-title" x="${r1(b.x + 10)}" y="${r1(b.y + 22 + i * 15)}">${esc(t)}</text>`),
        `<text class="svg-node-sub" x="${r1(b.x + 10)}" y="${r1(b.y + 22 + title.length * 15 + 1)}">${esc(who)}</text>`,
        times ? `<text class="svg-node-mono" x="${r1(b.x + 10)}" y="${r1(b.y + b.h - 20)}">${esc(times)}</text>` : "",
        stats ? `<text class="svg-node-mono${n.bottleneck ? " svg-crit-text" : ""}" x="${r1(b.x + 10)}" y="${r1(b.y + b.h - 7)}">${esc(stats)}</text>` : "",
      ].join("");
      const badges = [n.conflict ? "Conflict" : null, n.assumption ? "Assumption" : null].filter(Boolean) as string[];
      let bx = b.x + 8;
      const badgeSvg = badges
        .map((t) => {
          const bw = t.length * 5.6 + 12;
          const out = `<rect class="svg-badge ${t === "Conflict" ? "svg-badge-crit" : "svg-badge-warn"}" x="${r1(bx)}" y="${r1(b.y - 8)}" width="${r1(bw)}" height="14" rx="7"/><text class="svg-badge-text" x="${r1(bx + bw / 2)}" y="${r1(b.y + 2.5)}" text-anchor="middle">${t}</text>`;
          bx += bw + 4;
          return out;
        })
        .join("");
      const callout =
        n.callout !== null
          ? `<circle class="svg-callout" cx="${r1(b.x + b.w - 2)}" cy="${r1(b.y - 2)}" r="10"/><text class="svg-callout-text" x="${r1(b.x + b.w - 2)}" y="${r1(b.y + 2)}" text-anchor="middle">${n.callout}</text>`
          : "";
      return `<g><rect class="svg-node${n.bottleneck ? " svg-node-bn" : ""}" x="${r1(b.x)}" y="${r1(b.y)}" width="${b.w}" height="${b.h}" rx="6"/><rect x="${r1(b.x + 0.5)}" y="${r1(b.y + 0.5)}" width="${b.w - 1}" height="4" rx="2" fill="${stripe}"/>${lines}${badgeSvg}${callout}</g>`;
    })
    .join("");

  // One scale for every map (small ones aren't blown up); wide ones shrink to the page.
  return `<svg class="map" viewBox="${r1(minX)} ${r1(minY)} ${r1(w)} ${r1(h)}" width="${r1(w)}" height="${r1(h)}" style="width:min(100%,${r1(w * MAP_SCALE)}px)" role="img" aria-label="${esc(`Process map of ${map.name}`)}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="svg-arrow" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg>`;
}

/** The company map: the pipeline, and the servicing processes its clients run, with the hand-offs. */
export function companyMapSvg(map: CompanyMapView): string {
  const pipelines = map.processes.filter((p) => p.kind === "pipeline");
  const servicing = map.processes.filter((p) => p.kind === "servicing");
  const W = 230;
  const H = 76;
  const GAP = 22;
  const colX = [20, 500] as const;
  // Hand-offs to the same process share one arrow; its labels stack under it.
  const labels = new Map<string, { from: string; to: string; list: string[] }>();
  for (const h of map.handoffs) {
    const key = `${h.from} ${h.to}`;
    const entry = labels.get(key) ?? { from: h.from, to: h.to, list: [] };
    entry.list.push(h.label);
    labels.set(key, entry);
  }
  const labelsTo = (id: string) => Math.max(0, ...[...labels.values()].filter((l) => l.to === id).map((l) => l.list.length));
  const pos = new Map<string, Box>();
  let y = 20;
  for (const p of servicing) {
    pos.set(p.id, { x: colX[1], y, w: W, h: H });
    y += Math.max(H, H / 2 + 14 + labelsTo(p.id) * 13) + GAP;
  }
  const total = Math.max(y, H + 2 * GAP);
  pipelines.forEach((p, i) => pos.set(p.id, { x: colX[0], y: Math.max(20, (total - pipelines.length * (H + GAP)) / 2 + i * (H + GAP)), w: W, h: H }));
  const height = Math.max(total, ...[...pos.values()].map((b) => b.y + b.h + 20));
  const boxes = map.processes
    .map((p) => {
      const b = pos.get(p.id)!;
      const util = p.busiestRole ? `${p.busiestRole.name} ${pct(p.busiestRole.util)}` : "no staffed steps";
      const hot = p.busiestRole && p.busiestRole.util > 0.85;
      return `<g><rect class="svg-node${p.subject ? " svg-node-subject" : ""}" x="${b.x}" y="${r1(b.y)}" width="${b.w}" height="${b.h}" rx="6"/><text class="svg-node-title" x="${b.x + 12}" y="${r1(b.y + 22)}">${esc(wrap(p.name, 30, 1)[0])}</text><text class="svg-node-sub" x="${b.x + 12}" y="${r1(b.y + 40)}">${p.kind === "pipeline" ? "Pipeline" : "Servicing"} · ${p.steps} steps</text><text class="svg-node-mono${hot ? " svg-crit-text" : ""}" x="${b.x + 12}" y="${r1(b.y + 60)}">busiest: ${esc(util)}</text></g>`;
    })
    .join("");
  const arrows = [...labels.values()]
    .map(({ from, to, list }) => {
      const a = pos.get(from);
      const b = pos.get(to);
      if (!a || !b) return "";
      const sx = a.x + a.w;
      const sy = a.y + a.h / 2;
      const ty = b.y + b.h / 2;
      const vx = sx + 28;
      const text = list.map((l, i) => `<text class="svg-edge-label" x="${vx + 10}" y="${r1(ty + 15 + i * 13)}">${esc(wrap(l, 36, 1)[0])}</text>`).join("");
      return `<path class="svg-edge" d="M${sx} ${r1(sy)} H${vx} V${r1(ty)} H${b.x}" marker-end="url(#company-arrow)"/>${text}`;
    })
    .join("");
  const width = servicing.length ? colX[1] + W + 20 : colX[0] + W + 20;
  return `<svg class="map map-company" viewBox="0 0 ${width} ${r1(height)}" width="${width}" height="${r1(height)}" style="width:min(100%,${r1(width * 0.9)}px)" role="img" aria-label="Company map" xmlns="http://www.w3.org/2000/svg"><defs><marker id="company-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="svg-arrow" d="M0 0L10 5L0 10z"/></marker></defs>${arrows}${boxes}</svg>`;
}

/**
 * Horizontal utilisation bars: the average as a bar in the row's colour, the
 * 10th–90th percentile range as a line, the ceiling dashed and 100% solid.
 */
export function utilisationSvg(rows: readonly UtilisationRow[], threshold: number, label: string): string {
  if (!rows.length) return "";
  const LABEL = 170;
  const PLOT = 380;
  const VALUE = 110;
  const ROW = 24;
  const top = 22;
  const max = Math.max(1.2, ...rows.map((r) => r.util.p90 + 0.05));
  const x = (v: number) => LABEL + (Math.min(v, max) / max) * PLOT;
  const height = top + rows.length * ROW + 12;
  const width = LABEL + PLOT + VALUE;
  const body = rows
    .map((r, i) => {
      const y = top + i * ROW;
      const color = safeColor(r.color, "#6b736d");
      const hot = r.util.mean > threshold;
      return [
        `<text class="svg-axis-label" x="${LABEL - 8}" y="${y + 15}" text-anchor="end">${esc(wrap(r.name, 26, 1)[0])}</text>`,
        `<rect x="${LABEL}" y="${y + 5}" width="${r1(Math.max(0, x(r.util.mean) - LABEL))}" height="12" rx="2" fill="${color}" opacity="0.85"/>`,
        `<line class="svg-whisker" x1="${r1(x(r.util.p10))}" x2="${r1(x(r.util.p90))}" y1="${y + 11}" y2="${y + 11}"/>`,
        `<line class="svg-whisker" x1="${r1(x(r.util.p10))}" x2="${r1(x(r.util.p10))}" y1="${y + 7}" y2="${y + 15}"/>`,
        `<line class="svg-whisker" x1="${r1(x(r.util.p90))}" x2="${r1(x(r.util.p90))}" y1="${y + 7}" y2="${y + 15}"/>`,
        `<text class="svg-value${hot ? " svg-crit-text" : ""}" x="${LABEL + PLOT + 8}" y="${y + 15}">${pct(r.util.mean)} (${rangePct(r.util)})</text>`,
      ].join("");
    })
    .join("");
  const grid = [0, 0.5, threshold, 1]
    .map((v) => {
      const cls = v === threshold ? "svg-threshold" : v === 1 ? "svg-full" : "svg-grid";
      return `<line class="${cls}" x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${top - 4}" y2="${height - 8}"/><text class="svg-tick" x="${r1(x(v))}" y="${top - 8}" text-anchor="middle">${pct(v)}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${grid}${body}</svg>`;
}

const rangePct = (s: Stat) => (pct(s.p10) === pct(s.p90) ? pct(s.p10) : `${Math.round(s.p10 * 100)}–${pct(s.p90)}`);

/** Baseline vs scenario utilisation per role: two bars each, with their ranges. */
export function compareUtilSvg(rows: readonly { name: string; baseline: Stat; scenario: Stat }[], threshold: number, label: string): string {
  if (!rows.length) return "";
  const LABEL = 170;
  const PLOT = 380;
  const VALUE = 110;
  const ROW = 34;
  const top = 22;
  const max = Math.max(1.2, ...rows.flatMap((r) => [r.baseline.p90, r.scenario.p90]).map((v) => v + 0.05));
  const x = (v: number) => LABEL + (Math.min(v, max) / max) * PLOT;
  const height = top + rows.length * ROW + 30;
  const width = LABEL + PLOT + VALUE;
  const bar = (s: Stat, y: number, cls: string) =>
    `<rect class="${cls}" x="${LABEL}" y="${y}" width="${r1(Math.max(0, x(s.mean) - LABEL))}" height="10" rx="2"/><line class="svg-whisker" x1="${r1(x(s.p10))}" x2="${r1(x(s.p90))}" y1="${y + 5}" y2="${y + 5}"/>`;
  const body = rows
    .map((r, i) => {
      const y = top + i * ROW;
      return [
        `<text class="svg-axis-label" x="${LABEL - 8}" y="${y + 18}" text-anchor="end">${esc(wrap(r.name, 26, 1)[0])}</text>`,
        bar(r.baseline, y + 3, "svg-bar-base"),
        bar(r.scenario, y + 16, "svg-bar-scn"),
        `<text class="svg-value" x="${LABEL + PLOT + 8}" y="${y + 12}">${pct(r.baseline.mean)}</text>`,
        `<text class="svg-value" x="${LABEL + PLOT + 8}" y="${y + 25}">${pct(r.scenario.mean)}</text>`,
      ].join("");
    })
    .join("");
  const grid = [0, 0.5, threshold, 1]
    .map((v) => {
      const cls = v === threshold ? "svg-threshold" : v === 1 ? "svg-full" : "svg-grid";
      return `<line class="${cls}" x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${top - 4}" y2="${height - 26}"/><text class="svg-tick" x="${r1(x(v))}" y="${top - 8}" text-anchor="middle">${pct(v)}</text>`;
    })
    .join("");
  const ly = height - 10;
  const legend = `<rect class="svg-bar-base" x="${LABEL}" y="${ly - 9}" width="12" height="10" rx="2"/><text class="svg-tick" x="${LABEL + 16}" y="${ly}">Today</text><rect class="svg-bar-scn" x="${LABEL + 70}" y="${ly - 9}" width="12" height="10" rx="2"/><text class="svg-tick" x="${LABEL + 86}" y="${ly}">With the change</text><text class="svg-tick" x="${LABEL + 200}" y="${ly}">line: 10–90% range · dashed: ${pct(threshold)} ceiling</text>`;
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${grid}${body}${legend}</svg>`;
}

/** A client's mean health week by week, with the at-risk line at 50. */
export function sparklineSvg(values: readonly number[], label: string): string {
  const W = 120;
  const H = 28;
  if (values.length < 2) return "";
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 2 - (Math.max(0, Math.min(100, v)) / 100) * (H - 4);
  const points = values.map((v, i) => `${r1(x(i))},${r1(y(v))}`).join(" ");
  const last = values[values.length - 1]!;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg"><line class="svg-threshold" x1="0" x2="${W}" y1="${r1(y(50))}" y2="${r1(y(50))}"/><polyline class="svg-spark${last < 50 ? " svg-spark-risk" : ""}" points="${points}"/></svg>`;
}
