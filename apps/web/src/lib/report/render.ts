// The report as one HTML document with a print stylesheet (issue #28;
// docs/PRD.md §9). The server-side PDF (headless Chromium, pdf.ts) prints
// exactly this string, and the report route serves the same string for the
// browser's "Save as PDF", so the two are the same document by construction.
// Pure: content in, HTML out. Every value is escaped (html.ts).

import type { Stat } from "@transpera-flow/engine";
import { formatInitialState, formatPercent } from "@/lib/format";
import { SEVERITY_LABELS, TYPE_LABELS } from "@/lib/issues/register";
import { sectionLabel, type KpiFigure, type ReportContent, type ReportSectionId } from "./content";
import { figureRange, formatDate, formatDateTime, formatFigure, type FigureContext } from "./format";
import { esc, safeColor } from "./html";
import { companyMapSvg, compareUtilSvg, processMapSvg, sparklineSvg, utilisationSvg } from "./svg";

export interface RenderOptions {
  /** A toolbar for the screen (Print / Download), hidden when printing. Off for the server-side PDF. */
  toolbar?: { pdfUrl: string | null; backUrl: string | null } | null;
}

const DEFAULT_ACCENT = "#1c5cab";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";

/** The print stylesheet. Colours are the app's light tokens (docs/PRD.md §8.1); the accent can be branded (#34). */
export function reportCss(accent: string, footer = ""): string {
  const cssString = `"${footer.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/</g, "\\3c ")}"`;
  return `
:root{--bg:#f3f4f2;--panel:#fff;--panel-2:#e9ebe7;--line:#d5d8d2;--line-2:#c2c6bf;--fg:#15181a;--fg-2:#4d5451;--fg-3:#6b736d;--accent:${accent};--accent-soft:color-mix(in srgb,var(--accent) 14%,#fff);--good:#14875e;--warn:#eda100;--serious:#eb6834;--crit:#c93534;--crit-soft:#fbe1e0;--warn-soft:#fdf0d1;--good-soft:#d8f3e8;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--bg);color:var(--fg);font:10pt/1.45 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:"Bricolage Grotesque","IBM Plex Sans",system-ui,sans-serif;line-height:1.15;margin:0 0 6pt;break-after:avoid;page-break-after:avoid}
h1{font-size:26pt}
h2{font-size:17pt;margin-bottom:10pt;padding-bottom:5pt;border-bottom:2pt solid var(--accent)}
h3{font-size:12pt;margin-top:12pt}
p{margin:0 0 6pt}
.muted{color:var(--fg-2)}
.small{font-size:8.5pt}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:7.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--fg-3)}
.report{max-width:210mm;margin:0 auto}
.page{background:var(--panel);padding:14mm 14mm 16mm;margin:0 0 8mm;box-shadow:0 1px 2px rgba(20,24,30,.06),0 4px 14px rgba(20,24,30,.05)}
.cover{min-height:260mm;display:flex;flex-direction:column;justify-content:space-between;border-top:8pt solid var(--accent)}
.cover .logo{max-height:48pt;max-width:180pt;object-fit:contain}
.cover .title{margin-top:40mm}
.cover .sub{font-size:13pt;color:var(--fg-2)}
.runbox{border:1pt solid var(--line);border-radius:6pt;padding:8pt 10pt;background:var(--panel-2)}
.contents{columns:2;margin:6pt 0 0;padding-left:16pt}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6pt;margin:8pt 0 10pt;break-inside:avoid}
.kpi{border:1pt solid var(--line);border-radius:6pt;padding:6pt 8pt}
.kpi .v{font-family:"Bricolage Grotesque","IBM Plex Sans",sans-serif;font-size:14pt;font-weight:700}
.kpi .r{font-size:8pt;color:var(--fg-2)}
.kpi.crit .v{color:var(--crit)}
table{width:100%;border-collapse:collapse;margin:4pt 0 10pt;font-size:8.8pt;break-inside:avoid;page-break-inside:avoid}
table.long{break-inside:auto;page-break-inside:auto}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
th{text-align:left;font-weight:600;color:var(--fg-2);border-bottom:1pt solid var(--line-2);padding:3pt 5pt;font-size:8pt}
td{border-bottom:.5pt solid var(--line);padding:3pt 5pt;vertical-align:top}
td.num,th.num{text-align:right;white-space:nowrap}
td .r{display:block;font-size:7.5pt;color:var(--fg-3)}
table.clients td:first-child{min-width:34mm}
td.nowrap,th.nowrap{white-space:nowrap}
.good{color:var(--good)}.bad{color:var(--crit)}
figure{margin:6pt 0 10pt;break-inside:avoid;page-break-inside:avoid}
figure svg{display:block;width:100%;height:auto;max-height:150mm}
figure.chart-fig svg{max-height:120mm}
figcaption{font-size:8pt;color:var(--fg-2);margin-top:3pt}
.card{border:1pt solid var(--line);border-radius:6pt;padding:8pt 10pt;margin:0 0 10pt;break-inside:avoid;page-break-inside:avoid}
.card.accent{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 40%,#fff)}
.card.warn{background:var(--warn-soft);border-color:var(--warn)}
.scenario{break-before:auto}
.scenario + .scenario{break-before:page;page-break-before:always}
.pill{display:inline-block;border-radius:99pt;padding:0 6pt;font-size:7.5pt;font-weight:600;border:1pt solid var(--line-2)}
.sev-critical{background:var(--crit-soft);border-color:var(--crit)}
.sev-serious{background:#fde6dc;border-color:var(--serious)}
.sev-warning{background:var(--warn-soft);border-color:var(--warn)}
.sev-info{background:var(--panel-2)}
.callouts{margin:0 0 8pt;padding-left:0;list-style:none}
.callouts li{margin:0 0 3pt;padding-left:20pt;position:relative}
.callouts li b{position:absolute;left:0;top:0;display:inline-block;width:14pt;height:14pt;border-radius:50%;background:var(--crit);color:#fff;text-align:center;font-size:8pt;line-height:14pt}
ul.plain{padding-left:14pt;margin:2pt 0 8pt}
.map{font-family:"IBM Plex Sans",system-ui,sans-serif}
.svg-edge{fill:none;stroke:var(--line-2);stroke-width:1.4}
.svg-arrow{fill:var(--line-2)}
.svg-edge-label{font-size:10px;fill:var(--fg-2);paint-order:stroke;stroke:#fff;stroke-width:3px}
.svg-node{fill:var(--panel);stroke:var(--line-2);stroke-width:1}
.svg-node-bn{stroke:var(--crit);stroke-width:2.5}
.svg-node-subject{stroke:var(--accent);stroke-width:2}
.svg-node-title{font-size:12px;font-weight:600;fill:var(--fg)}
.svg-node-sub{font-size:10.5px;fill:var(--fg-2)}
.svg-node-mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;fill:var(--fg-3)}
.svg-crit-text{fill:var(--crit);font-weight:600}
.svg-term{stroke:var(--line-2);stroke-width:1}
.svg-term-start{fill:var(--panel-2)}.svg-term-won{fill:var(--good-soft);stroke:var(--good)}.svg-term-lost{fill:var(--crit-soft);stroke:var(--crit)}.svg-term-done{fill:var(--accent-soft)}
.svg-term-text{font-size:11px;font-weight:600;fill:var(--fg)}
.svg-badge{stroke-width:1}.svg-badge-crit{fill:var(--crit-soft);stroke:var(--crit)}.svg-badge-warn{fill:var(--warn-soft);stroke:var(--warn)}
.svg-badge-text{font-size:8.5px;font-weight:600;fill:var(--fg)}
.svg-callout{fill:var(--crit)}
.svg-callout-text{font-size:11px;font-weight:700;fill:#fff}
.chart{font-family:"IBM Plex Sans",system-ui,sans-serif}
.svg-axis-label{font-size:11px;fill:var(--fg)}
.svg-value{font-size:10.5px;fill:var(--fg-2);font-family:"IBM Plex Mono",ui-monospace,monospace}
.svg-tick{font-size:9.5px;fill:var(--fg-3)}
.svg-grid{stroke:var(--line);stroke-width:1}
.svg-full{stroke:var(--fg-3);stroke-width:1}
.svg-threshold{stroke:var(--crit);stroke-width:1;stroke-dasharray:3 3}
.svg-whisker{stroke:var(--fg);stroke-width:1.2}
.svg-bar-base{fill:var(--line-2)}
.svg-bar-scn{fill:var(--accent)}
.svg-spark{fill:none;stroke:var(--fg-2);stroke-width:1.5}
.svg-spark-risk{stroke:var(--crit)}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8pt;align-items:center;justify-content:space-between;max-width:210mm;margin:0 auto 6mm;padding:8pt 10pt;background:var(--panel);border:1pt solid var(--line);border-radius:6pt;font-size:10pt}
.toolbar a,.toolbar button{font:inherit;font-weight:600;border:1pt solid var(--line-2);border-radius:6pt;background:var(--panel);color:var(--fg);padding:4pt 10pt;text-decoration:none;cursor:pointer}
.toolbar .primary{background:var(--accent);border-color:var(--accent);color:#fff}
@page{size:A4;margin:14mm 14mm 16mm;@bottom-left{content:${cssString};font:8pt "IBM Plex Sans",sans-serif;color:#6b736d}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt "IBM Plex Sans",sans-serif;color:#6b736d}}
@media screen{body{padding:8mm 4mm}}
@media print{
  body{background:#fff}
  .toolbar{display:none}
  .report{max-width:none}
  .page{box-shadow:none;margin:0;padding:0;break-before:page;page-break-before:always}
  .page:first-child{break-before:auto;page-break-before:auto}
  .cover{min-height:255mm}
}
`;
}

/** The whole report as an HTML document. */
export function renderReportHtml(c: ReportContent, options: RenderOptions = {}): string {
  const accent = safeColor(c.branding.accent, DEFAULT_ACCENT);
  const ctx: FigureContext = { currency: c.run.currency, hoursPerWeek: c.run.hoursPerWeek };
  const sections = c.included.map((id) => SECTION_RENDERERS[id](c, ctx)).join("\n");
  const toolbar = options.toolbar
    ? `<div class="toolbar" role="toolbar" aria-label="Report"><span>${options.toolbar.backUrl ? `<a href="${esc(options.toolbar.backUrl)}">← Back</a>` : ""}</span><span style="display:flex;gap:6pt">${options.toolbar.pdfUrl ? `<a href="${esc(options.toolbar.pdfUrl)}">Download PDF</a>` : ""}<button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button></span></div>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(`${c.workspace.name} · ${c.title}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${reportCss(accent, `${c.workspace.name} · ${c.process.name} · ${formatDate(c.generatedAt)}`)}</style></head>
<body>${toolbar}<main class="report">
${sections}
</main></body></html>`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Renderer = (c: ReportContent, ctx: FigureContext) => string;

const section = (id: ReportSectionId, body: string, extra = "") =>
  `<section class="page ${extra}" id="${id}" data-section="${id}">${id === "cover" ? "" : `<h2>${esc(sectionLabel(id))}</h2>`}${body}</section>`;

const pct = formatPercent;
const rangeText = (s: Stat, fmt: (v: number) => string) => (fmt(s.p10) === fmt(s.p90) ? fmt(s.p10) : `${fmt(s.p10)}–${fmt(s.p90)}`);
const statCell = (s: Stat, fmt: (v: number) => string) => `${esc(fmt(s.mean))}<span class="r">${esc(rangeText(s, fmt))}</span>`;

function kpiTile(k: KpiFigure, ctx: FigureContext): string {
  const value = formatFigure(k.format, k.stat.mean, ctx);
  const range =
    k.range === "p50_p90"
      ? `P50 ${formatFigure(k.format, k.stat.p10, ctx)} · P90 ${formatFigure(k.format, k.stat.p90, ctx)}`
      : figureRange(k.format, k.stat, ctx);
  const crit = (k.key === "bottleneck" && k.stat.mean > 0.85) || (k.key === "clientsAtRisk" && k.stat.mean >= 1) || (k.key === "overtimeHours" && k.stat.mean > 0);
  return `<div class="kpi${crit ? " crit" : ""}" data-kpi="${esc(k.key)}"><div class="eyebrow">${esc(k.label)}</div><div class="v">${esc(value)}</div><div class="r">${esc(range)}</div></div>`;
}

const kpiGrid = (c: ReportContent, ctx: FigureContext) => `<div class="kpis">${c.kpis.map((k) => kpiTile(k, ctx)).join("")}</div>`;

const cover: Renderer = (c) => {
  const logo = c.branding.logoUrl && /^https:\/\//.test(c.branding.logoUrl) ? `<img class="logo" src="${esc(c.branding.logoUrl)}" alt="">` : "";
  const contents = c.included.filter((id) => id !== "cover").map((id) => `<li>${esc(sectionLabel(id))}</li>`).join("");
  const left = c.omitted.map((o) => `<li>${esc(sectionLabel(o.section))}: ${esc(o.reason)}</li>`).join("");
  return section(
    "cover",
    `<div>${logo}<div class="eyebrow">${esc(c.workspace.name)}</div>
<div class="title"><h1>${esc(c.process.name)}</h1><p class="sub">Process report · ${esc(formatDate(c.generatedAt))}</p></div></div>
<div><h3>Contents</h3><ol class="contents">${contents}</ol>${left ? `<p class="small muted" style="margin-top:6pt">Left out:</p><ul class="plain small muted">${left}</ul>` : ""}</div>
<div class="runbox small"><div class="eyebrow">The run behind every number</div>
<p style="margin:3pt 0 0">${esc(c.run.name)}${c.run.id ? ` <span class="mono">(${esc(c.run.id)})</span>` : ""}: ${c.run.reps} replications from seed ${c.run.seed}, ${c.run.horizonWeeks} weeks from ${esc(formatDate(c.run.startDate))}, engine ${esc(c.run.engineVersion)}. Revisions: ${esc(c.run.revisions.map((r) => `${r.name} r${r.number}`).join(", "))}.</p>
<p style="margin:3pt 0 0">Figures are averages across replications with the 10th–90th percentile range. Generated ${esc(formatDateTime(c.generatedAt))}${c.generatedBy ? ` by ${esc(c.generatedBy)}` : ""}.</p></div>`,
    "cover",
  );
};

const summary: Renderer = (c, ctx) =>
  section(
    "summary",
    `${kpiGrid(c, ctx)}${(c.summary?.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("")}${summaryNote(c)}`,
  );

/** Under the summary: who wrote it (#29); the appendix has the detail. */
function summaryNote(c: ReportContent): string {
  const s = c.summary;
  if (!s) return "";
  const edited = s.editedBy ? ` Edited by ${esc(s.editedBy)}.` : "";
  const text =
    s.source === "narration" && s.narration
      ? `Drafted by ${esc(s.narration.model)} from this report's figures; every number in it was checked against them.${edited}`
      : `Written from fixed templates using the run's own numbers.${edited}`;
  return `<p class="small muted" data-summary-note>${text}</p>`;
}

const companyMap: Renderer = (c) => {
  const m = c.companyMap!;
  const list = m.handoffs.length
    ? `<ul class="plain small">${m.handoffs.map((h) => `<li>${esc(m.processes.find((p) => p.id === h.from)?.name)} → ${esc(m.processes.find((p) => p.id === h.to)?.name)}: ${esc(h.label)}</li>`).join("")}</ul>`
    : `<p class="small muted">No servicing processes are linked to the services this pipeline sells.</p>`;
  return section(
    "company_map",
    `<figure>${companyMapSvg(m)}<figcaption>Each box is a process at its live revision; arrows are the servicing work a won client brings. “Busiest” is the most utilised role working its steps.</figcaption></figure>${list}`,
  );
};

const processMaps: Renderer = (c, ctx) => {
  const days = (h: number) => formatFigure("days", h, ctx);
  const maps = (c.processMaps ?? [])
    .map(
      (m) =>
        `<h3>${esc(m.name)} <span class="muted small">revision ${m.revision} · ${m.kind}</span></h3><figure>${processMapSvg(m)}<figcaption>Steps show who does them, hands-on time and wait, and the simulated average and maximum queue. Numbered circles mark the longest queues.</figcaption></figure>${
          m.callouts.length ? `<ol class="callouts">${m.callouts.map((co) => `<li><b>${co.n}</b>${esc(co.text)}</li>`).join("")}</ol>` : ""
        }`,
    )
    .join("");
  const b = c.bottlenecks;
  const bottleneck = b
    ? `<div class="block"><h3>Bottleneck</h3>${b.text.map((t) => `<p>${esc(t)}</p>`).join("")}
${b.shadowPrice ? `<div class="card accent" style="margin:6pt 0"><div class="eyebrow">Shadow price · +1 ${esc(b.shadowPrice.role)}</div><p style="margin:2pt 0 0">${esc(b.shadowPrice.text)}</p></div>` : ""}
<table><thead><tr><th>Role</th><th class="num">Utilisation</th><th class="num">Range</th></tr></thead><tbody>${b.roles
        .map((r) => `<tr><td>${esc(r.name)}</td><td class="num${r.overThreshold ? " bad" : ""}">${pct(r.util.mean)}</td><td class="num">${esc(rangeText(r.util, pct))}</td></tr>`)
        .join("")}</tbody></table>
${b.steps.length ? `<table><thead><tr><th>Where work queues</th><th class="num">Avg queue</th><th class="num">Max queue</th><th class="num">Avg wait to start</th></tr></thead><tbody>${b.steps.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.avgQueue.toFixed(1)}</td><td class="num">${Math.round(s.maxQueue)}</td><td class="num">${esc(days(s.avgWaitHours))}</td></tr>`).join("")}</tbody></table>` : ""}</div>`
    : "";
  return section("process_maps", `${maps}${bottleneck}`);
};

const clients: Renderer = (c, ctx) => {
  const v = c.clients!;
  const whole = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const money = (x: number) => formatFigure("money", x, ctx);
  const rows = v.clients
    .map(
      (cl) => `<tr><td>${esc(cl.name)}</td><td class="num">${esc(money(cl.mrr))}</td><td class="num">${Math.round(cl.startHealth)}</td><td class="num${cl.health.mean < 50 ? " bad" : ""}">${statCell(cl.health, (x) => String(Math.round(x)))}</td><td>${sparklineSvg(cl.trajectory, `${cl.name}: health week by week`)}</td><td class="num">${statCell(cl.churnMonthly, (x) => `${(x * 100).toFixed(1)}%`)}</td><td class="num">${pct(cl.atRisk)}</td><td class="num">${pct(cl.churned)}</td><td class="num">${whole(cl.touchpoints.onTime)} / ${whole(cl.touchpoints.late)} / ${whole(cl.touchpoints.missed)}</td></tr>`,
    )
    .join("");
  const t = v.touchpoints;
  return section(
    "clients",
    `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
<div class="kpi${v.atRisk.mean >= 1 ? " crit" : ""}"><div class="eyebrow">Clients at risk</div><div class="v">${esc(formatFigure("count", v.atRisk.mean, ctx))}</div><div class="r">${esc(figureRange("count", v.atRisk, ctx))}</div></div>
<div class="kpi"><div class="eyebrow">Churned / ${c.run.horizonWeeks} wks</div><div class="v">${esc(formatFigure("count", v.churned.mean, ctx))}</div><div class="r">${esc(figureRange("count", v.churned, ctx))}</div></div>
<div class="kpi"><div class="eyebrow">Touchpoints late · missed</div><div class="v">${t ? `${Math.round(t.late.mean)} · ${Math.round(t.missed.mean)}` : "–"}</div><div class="r">${t ? `of ${Math.round(t.onTime.mean + t.late.mean + t.missed.mean)} servicing tasks` : "no servicing mapped"}</div></div></div>
<table class="long clients"><thead><tr><th>Client</th><th class="num">MRR</th><th class="num">Health now</th><th class="num">Health at end</th><th>Trajectory</th><th class="num">Churn / month</th><th class="num">At risk</th><th class="num">Churned</th><th class="num">On time / late / missed</th></tr></thead><tbody>${rows}</tbody></table>
<p class="small muted">Most at risk first. “At risk” and “Churned” are the share of replications in which the client ends below health 50 or leaves; health and churn show the average with the 10th–90th percentile range. The dashed line on each trajectory is health 50.</p>`,
  );
};

const issues: Renderer = (c) => {
  const v = c.issues!;
  const groups = v.groups
    .map(
      (g) =>
        `<h3><span class="pill sev-${g.severity}">${esc(SEVERITY_LABELS[g.severity])}</span> ${g.issues.length} ${g.issues.length === 1 ? "issue" : "issues"}</h3><table class="long"><thead><tr><th style="width:40%">Issue</th><th>Where</th><th>Owner</th><th>Status</th><th>Linked fix</th></tr></thead><tbody>${g.issues
          .map(
            (i) =>
              `<tr><td><b>${esc(i.title)}</b><span class="r">${esc(TYPE_LABELS[i.type])}${i.evidence ? ` · ${esc(i.evidence)}` : ""}</span></td><td>${esc(i.where ?? "–")}</td><td>${esc(i.owner ?? "Unassigned")}</td><td>${esc(i.status)}</td><td>${i.fix ? `${esc(i.fix.name)}<span class="r">${i.fix.inReport ? "compared in this report" : "not compared in this report"}</span>` : "–"}</td></tr>`,
          )
          .join("")}</tbody></table>`,
    )
    .join("");
  return section("issues", `${groups}${v.closed ? `<p class="small muted">${v.closed} closed ${v.closed === 1 ? "issue is" : "issues are"} left out.</p>` : ""}`);
};

const scenarios: Renderer = (c) => {
  const items = (c.scenarios ?? [])
    .map(
      (s) => `<div class="scenario"><h3>${esc(s.name)}</h3>${s.description ? `<p class="muted">${esc(s.description)}</p>` : ""}<p class="small"><b>Changes:</b> ${esc(s.changes.join("; "))}</p>
<div class="card accent"><p style="margin:0"><b>${esc(s.headline)}</b></p>${s.details.map((d) => `<p style="margin:3pt 0 0">${esc(d)}</p>`).join("")}</div>
<table><thead><tr><th>Metric</th><th class="num">Today</th><th class="num">With the change</th><th class="num">Change</th></tr></thead><tbody>${s.table
        .map(
          (r) =>
            `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.baseline)}<span class="r">${esc(r.baselineRange)}</span></td><td class="num">${esc(r.scenario)}<span class="r">${esc(r.scenarioRange)}</span></td><td class="num ${r.tone === "good" ? "good" : r.tone === "bad" ? "bad" : ""}">${esc(r.change)}<span class="r">${esc(r.changeRange)}</span></td></tr>`,
        )
        .join("")}</tbody></table>
<figure class="chart-fig">${compareUtilSvg(s.roles, 0.85, `Utilisation by role, today and with ${s.name}`)}<figcaption>Utilisation by role, today and with the change. Bottleneck today: ${esc(s.bottleneck.baseline ?? "none")}; with the change: ${esc(s.bottleneck.scenario ?? "none")}.</figcaption></figure>
${s.robustness ? `<div class="card"><div class="eyebrow">Robustness</div><p style="margin:2pt 0 0">${esc(s.robustness.verdict)}</p>${s.robustness.complete ? "" : `<p class="small bad" style="margin:2pt 0 0">The check ran out of time before covering every input; see Robustness.</p>`}</div>` : ""}</div>`,
    )
    .join("");
  const excluded = c.excludedScenarios.length
    ? `<div class="card warn"><b>Left out (needs attention):</b><ul class="plain">${c.excludedScenarios.map((s) => `<li>${esc(s.name)}: ${esc(s.reason)}</li>`).join("")}</ul></div>`
    : "";
  return section(
    "scenarios",
    `<p class="small muted">Each scenario is compared with today replication by replication (same random numbers), so the change's range is the range of paired differences. Averages first, the 10th–90th percentile range underneath.</p>${excluded}${items}`,
  );
};

const utilisation: Renderer = (c) => {
  const u = c.utilisation!;
  const table = (rows: typeof u.roles) =>
    `<table class="long"><thead><tr><th>Name</th><th class="num">Total</th><th class="num">Range</th><th class="num">Pipeline</th><th class="num">Servicing</th><th class="num">Ongoing clients</th><th class="num">Overtime</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td class="num${r.util.mean > u.threshold ? " bad" : ""}">${pct(r.util.mean)}</td><td class="num">${esc(rangeText(r.util, pct))}</td><td class="num">${pct(r.pipeline)}</td><td class="num">${pct(r.servicing)}</td><td class="num">${pct(r.ongoing)}</td><td class="num">${pct(r.overtime)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  return section(
    "utilisation",
    `<h3>By role</h3><figure class="chart-fig">${utilisationSvg(u.roles, u.threshold, "Utilisation by role")}<figcaption>Bar: average utilisation. Line: 10th–90th percentile range. Dashed: the ${pct(u.threshold)} ceiling; solid: 100%.</figcaption></figure>${table(u.roles)}
<h3>By person</h3><p class="small muted">Capacity, not performance: people are listed by name, never ranked. Shares are of contracted capacity; total utilisation can pass 100% when work exceeds capacity and overtime.</p><figure class="chart-fig">${utilisationSvg(u.people, u.threshold, "Utilisation by person")}</figure>${table(u.people)}`,
  );
};

const robustness: Renderer = (c) => {
  const items = (c.scenarios ?? [])
    .filter((s) => s.robustness)
    .map((s) => {
      const r = s.robustness!;
      return `<div class="card"><h3 style="margin-top:0">${esc(s.name)}</h3><p><b>${esc(r.verdict)}</b></p>${r.details.map((d) => `<p class="small muted">${esc(d)}</p>`).join("")}
${r.conflicts.length ? `<div class="card warn">${r.conflicts.map((x) => `<p style="margin:0">${esc(x)}</p>`).join("")}</div>` : ""}
${r.sensitive.length ? `<table><thead><tr><th>Most sensitive inputs</th><th>Effect on the change (per quarter)</th></tr></thead><tbody>${r.sensitive.map((x) => `<tr><td>${esc(x.label)}</td><td${x.flips ? ' class="bad"' : ""}>${esc(x.effect)}</td></tr>`).join("")}</tbody></table>` : ""}
<p class="small muted">${r.jobs ? `${r.cached} of ${r.jobs} runs came from the cache of earlier checks.` : "Nothing to run."}${r.complete ? "" : " Stopped early by the time limit; the shares cover the inputs checked."}</p></div>`;
    })
    .join("");
  return section("robustness", `<p class="small muted">Does each conclusion hold if the estimates are off? Every estimated input is moved down and up in turn (conflicting estimates across the range people gave).</p>${items}`);
};

const appendix: Renderer = (c) => {
  const a = c.appendix!;
  const status = { assumption: "Unconfirmed assumption", estimate: "Estimate", conflict: "Sources disagree" } as const;
  const parts = [
    `<h3>Provenance</h3><ul class="plain small">${a.provenance.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`,
    a.conflicts.length
      ? `<h3>Where sources disagree</h3><table class="long"><thead><tr><th>Where</th><th>Value</th><th>What was said</th><th>Settled</th></tr></thead><tbody>${a.conflicts.map((x) => `<tr><td>${esc(x.where)}</td><td>${esc(x.parameter)}</td><td>${esc(x.values)}</td><td>${x.resolved ? "yes" : "no"}</td></tr>`).join("")}</tbody></table>`
      : "",
    `<h3>Assumptions and estimates on the map</h3>${
      a.assumptions.length
        ? `<table class="long"><thead><tr><th>Where</th><th>Value</th><th class="num">Used</th><th>Status</th><th>Note</th></tr></thead><tbody>${a.assumptions.map((x) => `<tr><td>${esc(x.where)}</td><td class="nowrap">${esc(x.parameter)}</td><td class="num">${esc(x.value)}</td><td>${esc(status[x.status])}</td><td class="small">${esc(x.note ?? "")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">Every value on the map was entered or measured.</p>`
    }`,
    a.company.length
      ? `<h3>Company-model estimates</h3><table class="long"><thead><tr><th>Value</th><th class="num">Used</th><th>Source</th></tr></thead><tbody>${a.company.map((x) => `<tr><td>${esc(x.parameter)}</td><td class="num">${esc(x.value)}</td><td>${esc(x.source)}</td></tr>`).join("")}</tbody></table>`
      : "",
    a.evidence.length
      ? `<h3>Evidence</h3><table class="long"><thead><tr><th>Where</th><th>Value</th><th style="width:45%">Quote</th><th>Who, where</th></tr></thead><tbody>${a.evidence.map((x) => `<tr><td>${esc(x.where)}</td><td>${esc(x.parameter)}</td><td>“${esc(x.quote)}”</td><td class="small">${esc([x.speaker, x.source, x.timestamp].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table>`
      : "",
    a.sources.length
      ? `<h3>Sources</h3><table class="long"><thead><tr><th>Source</th><th>Kind</th><th>Speakers</th><th>Date</th><th class="num">Values citing it</th></tr></thead><tbody>${a.sources.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.kind)}</td><td>${esc(s.speakers.join(", "))}</td><td>${esc(s.recordedAt ? formatDate(s.recordedAt) : "")}</td><td class="num">${s.citations}</td></tr>`).join("")}</tbody></table>`
      : "",
  ];
  return section("appendix", parts.join(""));
};

const methodology: Renderer = (c, ctx) =>
  section(
    "methodology",
    `${(c.methodology?.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("")}<p class="small muted">${esc(formatInitialState(c.run.initialState, ctx.hoursPerWeek))}.</p>`,
  );

const SECTION_RENDERERS: Record<ReportSectionId, Renderer> = {
  cover,
  summary,
  company_map: companyMap,
  process_maps: processMaps,
  clients,
  issues,
  scenarios,
  utilisation,
  robustness,
  appendix,
  methodology,
};
