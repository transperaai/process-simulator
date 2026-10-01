// Assembling the report's content (issue #28; docs/PRD.md §9 "PDF", §6.4,
// §6.5, §7.3). Given the live model's rows, the workspace's scenarios,
// issues and sources, and the run to report on (seed, replications), this
// runs the engine (the baseline, one comparison per included scenario, the
// shadow price and the robustness checks) and puts every number and sentence
// into one `ReportContent`. Deterministic for a given input: the engine is
// seeded, sentences come from its fixed templates (never a language model),
// and the only clock is the robustness time cap, which is injected. No I/O:
// the server and the demo load the rows and store the result.

import {
  EVIDENCE_COLUMNS,
  EVIDENCE_LABELS,
  citationsBySource,
  columnProvenance,
  engineRecurrence,
  evidenceOf,
  formatParameter,
  isOpenAssumption,
  openConflict,
  toEngineModel,
  type IssueRow,
  type ProcessBundle,
  type ProcessPart,
  type ProvenanceMap,
  type ScenarioRow,
  type SourceRow,
  type StepRow,
} from "@transpera-flow/db";
import {
  DEFAULT_HEALTH_RULES,
  checkScenario,
  detectBrokenScenarios,
  detectIssues,
  headlineSubject,
  healthRules,
  parameterLabel,
  recurrenceLabel,
  robustness,
  robustnessVerdict,
  simulate,
  type DetectedIssue,
  type EngineModel,
  ratingOfStored,
  type Rating,
  type RobustnessCache,
  type ScenarioPatch,
  type SimulationResult,
  type Stat,
} from "@transpera-flow/engine";
import { bottleneckReport, compareScenarios, robustnessParameters } from "@transpera-flow/mcp";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { RATINGS_WORST_FIRST, STATUS_LABELS, registerEntries } from "@/lib/issues/register";
import { retiredSteps } from "@/lib/scenarios/broken";
import {
  REPORT_CONTENT_VERSION,
  SECTION_IDS,
  type AppendixView,
  type BottleneckSection,
  type ClientsView,
  type CompanyMapView,
  type ExecutiveSummary,
  type IssueView,
  type IssuesView,
  type KpiFigure,
  type MapNode,
  type ProcessMapView,
  type ReportBranding,
  type ReportContent,
  type ReportSectionId,
  type RobustnessView,
  type ScenarioView,
  type UtilisationRow,
  type UtilisationView,
} from "./content";
import { formatDateTime } from "./format";
import { buildMethodology, buildSummary, summaryProvenance, textNote } from "./summary";

/** The run a report is generated from (a saved `runs` row, or one made for it). */
export interface ReportRunInput {
  id: string | null;
  name: string;
  seed: number;
  reps: number;
  /**
   * The engine version the saved run recorded (`runs.engine_version`, issue
   * #22). Null: the engine that runs it now (`SimulationResult.engineVersion`).
   */
  engineVersion: string | null;
  /** ISO date the run starts on. */
  startDate: string;
  savedAt: string | null;
}

export interface ReportInput {
  /** The live pipeline (with its servicing processes in `otherProcesses`). */
  bundle: ProcessBundle;
  scenarios: readonly ScenarioRow[];
  /** Tracked issues (the register's stored rows). */
  issues: readonly IssueRow[];
  sources: readonly SourceRow[];
  run: ReportRunInput;
  /** Sections asked for (the cover always prints) and saved scenarios to compare, in order. */
  options: { sections: readonly ReportSectionId[]; scenarioIds: readonly string[] };
  generatedAt: string;
  generatedBy: string | null;
  branding?: ReportBranding;
  robustness: {
    /** Job results kept between checks (docs/PRD.md §6.5 "Cached"). */
    cache?: RobustnessCache;
    /** Time for every check together; a check that runs out says so ("Stopped early"). */
    timeBudgetMs: number;
    now?: () => number;
  };
  /** Cap on the shadow price's extra replications. */
  shadowPriceBudgetMs: number;
}

export interface BuiltReport {
  content: ReportContent;
  model: EngineModel;
  /** The baseline run: `simulate(model, run.reps, run.seed)`. */
  baseline: SimulationResult;
}

const THRESHOLD = 0.85;

/** Sections in print order, the cover first, whatever order they were asked for in. */
export function normaliseSections(sections: readonly string[]): ReportSectionId[] {
  const asked = new Set(sections);
  return SECTION_IDS.filter((id) => id === "cover" || asked.has(id));
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Every process part the run covers: the pipeline, then its servicing processes. */
function partsOf(bundle: ProcessBundle): ProcessPart[] {
  return [
    { process: bundle.process, revision: bundle.revision, steps: bundle.steps, edges: bundle.edges },
    ...(bundle.otherProcesses ?? []).filter((p) => p.process.kind === "servicing"),
  ];
}

const OPS: Record<ScenarioPatch["op"], (v: number) => string> = {
  set: (v) => `set to ${v}`,
  multiply: (v) => `× ${v}`,
  add: (v) => (v >= 0 ? `+${v}` : `−${Math.abs(v)}`),
};

/** A scenario's patches in words: "Strategist: head-count +1". */
export function describePatches(model: EngineModel, patch: readonly ScenarioPatch[]): string[] {
  return patch.map((p) => `${parameterLabel(model, p.path)} ${OPS[p.op](p.value)}`);
}

export function buildReportContent(input: ReportInput): BuiltReport {
  const { bundle, run } = input;
  const settings = bundle.workspace.settings;
  const currency = settings.currency;
  const model = toEngineModel(bundle, { startDate: run.startDate });
  const baseline = simulate(model, run.reps, run.seed);
  const k = baseline.kpi;
  const parts = partsOf(bundle);
  const allSteps = parts.flatMap((p) => p.steps);
  const stepName = new Map(allSteps.map((s) => [s.id, s.name]));
  const roleById = new Map(bundle.roles.map((r) => [r.id, r]));
  const personName = new Map(bundle.people.map((p) => [p.id, p.name]));
  const clientName = new Map((bundle.clients ?? []).map((c) => [c.id, c.name]));
  const roleNames = Object.fromEntries(Object.entries(model.roles).map(([id, r]) => [id, r.name]));

  const asked = normaliseSections(input.options.sections);
  const omitted: ReportContent["omitted"] = [];
  const wants = (id: ReportSectionId) => asked.includes(id);
  const skip = (id: ReportSectionId, reason: string) => {
    if (wants(id)) omitted.push({ section: id, reason });
  };

  // --- Scenarios asked for: the ones that resolve run; the others are listed as needing attention (D10).
  const retired = retiredSteps(bundle);
  const chosen = input.options.scenarioIds.flatMap((id) => input.scenarios.filter((s) => s.id === id));
  const excludedScenarios: ReportContent["excludedScenarios"] = [];
  const runnable = chosen.filter((s) => {
    const check = checkScenario(model, s.patch, retired);
    if (check.status === "ok") return true;
    excludedScenarios.push({ id: s.id, name: s.name, reason: `It needs attention: ${check.broken.map((b) => b.message).join(" ")}` });
    return false;
  });

  // --- Bottlenecks and the shadow price (docs/PRD.md §6.4), paired with the baseline.
  const bn = bottleneckReport({ model, reps: run.reps, seed: run.seed, timeBudgetMs: input.shadowPriceBudgetMs, limit: 5, run: baseline });
  const bottlenecks: BottleneckSection = {
    text: [bn.top?.evidence, bn.steps[0]?.evidence].filter((s): s is string => Boolean(s)),
    roles: bn.roles.map((r) => ({ name: r.name, util: r.util, overThreshold: r.overThreshold })),
    steps: bn.steps.slice(0, 5).map((s) => ({ name: s.name, avgQueue: s.avgQueue, maxQueue: s.maxQueue, avgWaitHours: s.avgWaitHours })),
    shadowPrice: bn.shadow_price
      ? {
          role: bn.shadow_price.role.name,
          perQuarter: bn.shadow_price.per_quarter,
          text: bn.shadow_price.text,
          reps: bn.shadow_price.reps,
          complete: bn.shadow_price.complete,
        }
      : null,
    threshold: bn.threshold,
  };
  if (!bn.top) bottlenecks.text.push("No role limits this process: nothing is staffed, so only demand limits it.");

  // --- Scenario comparisons and their robustness (run automatically for every included scenario, §6.5).
  const now = input.robustness.now ?? (() => performance.now());
  const deadline = now() + input.robustness.timeBudgetMs;
  // What is estimated, and so perturbed: steps, services and the health rules (issues #20, #79).
  const provenanceRows = { steps: allSteps, services: bundle.services, workspace: bundle.workspace.provenance };
  const scenarios: ScenarioView[] = runnable.map((s, i) => {
    const cmp = compareScenarios({ model, a: [], b: [{ id: s.id, name: s.name, patch: s.patch }], reps: run.reps, seed: run.seed, currency });
    let robust: RobustnessView;
    {
      const left = Math.max(0, deadline - now());
      const budget = left / (runnable.length - i);
      const parameters = robustnessParameters(model, provenanceRows, "won");
      const { subject, plural } = headlineSubject([s.name], false);
      if (parameters.length) {
        const result = robustness(model, s.patch, {
          parameters,
          seed: run.seed,
          metric: "won",
          timeBudgetMs: budget,
          ...(input.robustness.cache ? { cache: input.robustness.cache } : {}),
          ...(input.robustness.now ? { now: input.robustness.now } : {}),
        });
        const v = robustnessVerdict({ result, subject, plural, roleNames, horizonWeeks: model.horizonWeeks, currency });
        robust = {
          verdict: v.verdict,
          details: v.details,
          sensitive: v.sensitive,
          conflicts: v.conflicts,
          complete: result.complete,
          jobs: result.stats.jobs,
          cached: result.stats.cached,
          signHolds: result.signHolds,
        };
      } else {
        robust = {
          verdict: "Every input is entered or measured, so there is nothing estimated to check.",
          details: [],
          sensitive: [],
          conflicts: [],
          complete: true,
          jobs: 0,
          cached: 0,
          signHolds: 1,
        };
      }
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      changes: describePatches(model, s.patch),
      headline: cmp.headline,
      details: cmp.details,
      table: cmp.table.map((r) => ({
        label: r.label,
        baseline: r.baseline,
        baselineRange: r.baselineRange,
        scenario: r.scenario,
        scenarioRange: r.scenarioRange,
        change: r.change,
        changeRange: r.changeRange,
        tone: r.tone,
      })),
      roles: cmp.utilisation.roles.flatMap((r) =>
        r.baseline && r.scenario ? [{ name: r.name, color: roleById.get(r.id)?.color ?? null, baseline: r.baseline, scenario: r.scenario }] : [],
      ),
      bottleneck: { baseline: cmp.bottleneck.baseline?.name ?? null, scenario: cmp.bottleneck.scenario?.name ?? null },
      robustness: robust,
    };
  });

  // --- KPIs (every headline figure with its range; docs/PRD.md §6.4, §13).
  const kpis: KpiFigure[] = [
    { key: "won", label: `Wins / ${model.horizonWeeks} wks`, format: "count", stat: k.won, definition: "Items reaching a won end in the horizon." },
    { key: "lost", label: "Lost", format: "count", stat: k.lost, definition: "Items reaching a lost end without being won." },
    {
      key: "cycle",
      label: "Cycle time",
      format: "days",
      stat: { mean: k.cycle.mean, p10: k.cycle.p50, p90: k.cycle.p90 },
      range: "p50_p90",
      definition: "Arrival to an end, in working days: the mean, the median (P50) and the 90th percentile (P90).",
    },
    { key: "mrrAdded", label: "New MRR", format: "money", stat: k.mrrAdded, definition: "Monthly fees of the retainer clients won in the horizon." },
    { key: "billed", label: `Billed / ${model.horizonWeeks} wks`, format: "money", stat: k.billed, definition: "Revenue billed within the horizon, net of churn." },
    { key: "ltvAdded", label: "LTV added", format: "money", stat: k.ltvAdded, definition: "For each new win: price × expected tenure (retainers) or the price (one-off)." },
    { key: "lostRevenue", label: "Lost revenue", format: "money", stat: k.lostRevenue, definition: "What lost leads would have been worth if won." },
    { key: "overtimeHours", label: `Overtime / ${model.horizonWeeks} wks`, format: "hours", stat: k.overtimeHours, definition: "Hours worked beyond people's weeks, up to the overtime cap." },
  ];
  if (baseline.bnRole) {
    kpis.splice(3, 0, {
      key: "bottleneck",
      label: `Bottleneck: ${roleNames[baseline.bnRole] ?? "role"}`,
      format: "percent",
      stat: k.roles[baseline.bnRole]!.util,
      definition: "Utilisation of the busiest role.",
    });
  }
  if (model.clients && k.clientsAtRisk && k.clientsChurned) {
    kpis.push(
      { key: "clientsAtRisk", label: "Clients at risk", format: "count", stat: k.clientsAtRisk, definition: "Active clients whose health ends the horizon below 50." },
      { key: "clientsChurned", label: `Churned / ${model.horizonWeeks} wks`, format: "count", stat: k.clientsChurned, definition: "Clients who leave in the horizon." },
    );
  }

  // --- Process maps with bottleneck callouts.
  // The three longest queues, numbered in the order the maps print.
  const order = new Map(parts.flatMap((p) => p.steps.map((s) => s.id)).map((id, i) => [id, i]));
  const calloutSteps = bn.steps.slice(0, 3).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const calloutNo = new Map(calloutSteps.map((s, i) => [s.id, i + 1]));
  const processMaps: ProcessMapView[] = parts.map((part) => {
    const nodes: MapNode[] = part.steps.map((s) => {
      const r = baseline.steps[s.id];
      const role = s.role_id ? roleById.get(s.role_id) : undefined;
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        outcome: s.outcome,
        x: Number(s.x),
        y: Number(s.y),
        role: role ? { name: role.name, color: role.color } : null,
        person: s.person_id ? (personName.get(s.person_id) ?? null) : null,
        workHours: Number(s.work_hours),
        waitHours: Number(s.wait_hours),
        rework: Number(s.rework_rate),
        stats: r ? { avgQueue: r.avgQueue, maxQueue: r.maxQueue, avgWaitHours: r.avgWait, arrivals: r.arrivals } : null,
        callout: calloutNo.get(s.id) ?? null,
        bottleneck: s.id === baseline.bnStep,
        assumption: s.assumption || EVIDENCE_COLUMNS.some((c) => isOpenAssumption(s, c)),
        conflict: s.conflict || EVIDENCE_COLUMNS.some((c) => openConflict(s, c) !== null),
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    return {
      id: part.process.id,
      name: part.process.name,
      kind: part.process.kind,
      revision: part.revision.number,
      nodes,
      edges: part.edges
        .filter((e) => ids.has(e.from_step_id) && ids.has(e.to_step_id))
        .map((e) => ({ from: e.from_step_id, to: e.to_step_id, probability: Number(e.probability), tag: e.condition_tag, label: e.label })),
      callouts: calloutSteps.filter((s) => part.steps.some((x) => x.id === s.id)).map((s) => ({ n: calloutNo.get(s.id)!, stepId: s.id, text: s.evidence })),
    };
  });

  // --- Company map: the pipeline and the servicing processes its clients run.
  const busiestIn = (part: ProcessPart) => {
    const roleIds = new Set(part.steps.flatMap((s) => (s.role_id ? [s.role_id] : [])));
    let best: { name: string; util: number } | null = null;
    for (const id of roleIds) {
      const u = k.roles[id]?.util.mean;
      if (u !== undefined && (!best || u > best.util)) best = { name: roleNames[id] ?? id, util: u };
    }
    return best;
  };
  const working = (part: ProcessPart) => part.steps.filter((s) => s.kind !== "start" && s.kind !== "end").length;
  const companyMap: CompanyMapView = {
    processes: parts.map((p) => ({
      id: p.process.id,
      name: p.process.name,
      kind: p.process.kind,
      steps: working(p),
      subject: p.process.id === bundle.process.id,
      busiestRole: busiestIn(p),
    })),
    handoffs: (bundle.servicingLinks ?? []).flatMap((l) => {
      const to = parts.find((p) => p.process.id === l.process_id);
      const service = bundle.services.find((s) => s.id === l.service_id);
      const r = engineRecurrence(l.recurrence);
      if (!to || !service) return [];
      return [{ from: bundle.process.id, to: to.process.id, label: `${service.name}: ${r ? recurrenceLabel(r) : "recurring"}` }];
    }),
  };

  // --- Utilisation (capacity, not performance: people in name order, never ranked; D20).
  const utilRow = (id: string, name: string, color: string | null, u: { util: Stat; pipeline: Stat; servicing: Stat; ongoing: Stat; overtime: Stat }): UtilisationRow => ({
    id,
    name,
    color,
    util: u.util,
    pipeline: u.pipeline.mean,
    servicing: u.servicing.mean,
    ongoing: u.ongoing.mean,
    overtime: u.overtime.mean,
  });
  const utilisation: UtilisationView = {
    threshold: THRESHOLD,
    roles: Object.entries(k.roles).map(([id, u]) => utilRow(id, roleNames[id] ?? id, roleById.get(id)?.color ?? null, u)),
    people: Object.entries(k.people)
      .map(([id, u]) => {
        const p = baseline.resolvedPeople[id];
        const color = p?.roles[0] ? (roleById.get(p.roles[0])?.color ?? null) : null;
        return utilRow(id, p?.name ?? id, color, u);
      })
      .sort(byName),
  };

  // --- Clients (docs/PRD.md §6.3.5).
  let clients: ClientsView | null = null;
  if (baseline.clients && k.clientsAtRisk && k.clientsChurned) {
    const rules = healthRules(model);
    clients = {
      atRisk: k.clientsAtRisk,
      churned: k.clientsChurned,
      touchpoints: k.touchpoints ?? null,
      clients: Object.entries(baseline.clients)
        .map(([id, c]) => ({
          id,
          name: c.name,
          mrr: model.clients?.[id]?.mrr ?? 0,
          startHealth: model.clients?.[id]?.health ?? rules.initial,
          health: c.health,
          trajectory: c.trajectory,
          churnMonthly: c.churnMonthly,
          churned: c.churned,
          atRisk: c.atRisk,
          touchpoints: c.touchpoints,
        }))
        .sort((a, b) => b.atRisk - a.atRisk || b.churned - a.churned || a.health.mean - b.health.mean || a.name.localeCompare(b.name)),
    };
  }

  // --- Issues: tracked ones and this run's detections, grouped by rating, with owner and linked fix.
  const detected: DetectedIssue[] = [
    ...detectBrokenScenarios(model, input.scenarios, retired),
    ...detectIssues(model, baseline),
    ...perceptionGapDetections(allSteps),
  ];
  const inReport = new Set(runnable.map((s) => s.id));
  const scenarioById = new Map(input.scenarios.map((s) => [s.id, s]));
  const matching = (patch: readonly ScenarioPatch[]) => {
    const key = (p: readonly ScenarioPatch[]) => JSON.stringify(p.map(({ path, op, value }) => [path, op, value]));
    return input.scenarios.find((s) => key(s.patch) === key(patch)) ?? null;
  };
  let closed = 0;
  const views: IssueView[] = [];
  for (const e of registerEntries([...input.issues], detected)) {
    if (e.kind === "tracked") {
      const i = e.issue;
      const open = i.status === "open" || i.status === "in_progress" || (i.status === "done" && e.detection !== null);
      if (!open) {
        closed++;
        continue;
      }
      const s = i.scenario_id ? scenarioById.get(i.scenario_id) : undefined;
      views.push({
        title: i.title,
        type: i.type,
        rating: ratingOfStored(i.severity),
        status: STATUS_LABELS[i.status],
        source: i.source,
        where: whereOf(i.step_id, i.person_id, i.role_id, i.client_id),
        owner: i.owner_person_id ? (personName.get(i.owner_person_id) ?? null) : null,
        evidence: e.detection?.evidence ?? i.evidence,
        fix: s ? { name: s.name, inReport: inReport.has(s.id) } : null,
      });
    } else {
      const d = e.detection;
      const saved = d.fix ? matching(d.fix.patch) : d.scenarioId ? (scenarioById.get(d.scenarioId) ?? null) : null;
      views.push({
        title: d.title,
        type: d.type,
        rating: d.rating,
        status: "Detected",
        source: "detected",
        where: whereOf(d.stepId, d.personId, d.roleId, d.clientId ?? null),
        owner: null,
        evidence: d.evidence,
        fix: saved ? { name: saved.name, inReport: inReport.has(saved.id) } : d.fix ? { name: d.fix.name, inReport: false } : null,
      });
    }
  }
  function whereOf(stepId: string | null, personId: string | null, roleId: string | null, clientId: string | null): string | null {
    const bits = [
      stepId ? stepName.get(stepId) : undefined,
      personId ? personName.get(personId) : undefined,
      !personId && roleId ? roleNames[roleId] : undefined,
      clientId ? clientName.get(clientId) : undefined,
    ].filter((s): s is string => Boolean(s));
    return bits.length ? bits.join(" · ") : null;
  }
  const issues: IssuesView = {
    groups: RATINGS_WORST_FIRST.map((rating: Rating) => ({ rating, issues: views.filter((v) => v.rating === rating) })).filter((g) => g.issues.length),
    closed,
  };

  // --- Appendix: assumptions, evidence, conflicts, sources and provenance (docs/PRD.md §7.1b, D17).
  const appendix = buildAppendix(input, parts, model, stepName);

  // --- Which sections print.
  const included: ReportSectionId[] = [];
  for (const id of asked) {
    if (id === "clients" && !clients) {
      skip(id, "The workspace has no client roster, so there is no client health to report.");
      continue;
    }
    if ((id === "scenarios" || id === "robustness") && !scenarios.length) {
      skip(id, chosen.length ? "None of the chosen scenarios can run: they need attention." : "No scenarios were chosen.");
      continue;
    }
    if (id === "issues" && !views.length) {
      skip(id, "There are no open issues.");
      continue;
    }
    included.push(id);
  }

  const content: ReportContent = {
    version: REPORT_CONTENT_VERSION,
    title: `${bundle.process.name}: process report`,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    workspace: { id: bundle.workspace.id, name: bundle.workspace.name },
    names: { people: bundle.people.map((p) => p.name), clients: (bundle.clients ?? []).map((c) => c.name) },
    branding: input.branding ?? { accent: null, logoUrl: null },
    process: { id: bundle.process.id, name: bundle.process.name, entityName: bundle.process.entity_name },
    run: {
      id: run.id,
      name: run.name,
      seed: run.seed,
      reps: run.reps,
      engineVersion: run.engineVersion ?? baseline.engineVersion,
      startDate: run.startDate,
      horizonWeeks: model.horizonWeeks,
      hoursPerWeek: model.hoursPerWeek,
      currency,
      initialState: baseline.initialState,
      revisions: parts.map((p) => ({ processId: p.process.id, name: p.process.name, number: p.revision.number })),
      savedAt: run.savedAt,
      cycle: k.cycle,
    },
    options: { sections: asked, scenarioIds: [...input.options.scenarioIds] },
    included,
    omitted,
    summary: null,
    kpis,
    companyMap: included.includes("company_map") ? companyMap : null,
    processMaps: included.includes("process_maps") ? processMaps : null,
    bottlenecks: included.includes("process_maps") || included.includes("summary") ? bottlenecks : null,
    clients: included.includes("clients") || included.includes("summary") ? clients : null,
    issues: included.includes("issues") || included.includes("summary") ? issues : null,
    scenarios: scenarios.length ? scenarios : null,
    excludedScenarios,
    utilisation: included.includes("utilisation") ? utilisation : null,
    appendix: included.includes("appendix") ? appendix : null,
    methodology: null,
  };
  content.summary = included.includes("summary") ? buildSummary(content) : null;
  content.methodology = included.includes("methodology") ? buildMethodology(content, model) : null;
  if (content.appendix) content.appendix.provenance = provenanceLines(content);
  return { content, model, baseline };
}

/** The appendix's lists (provenance lines are added once the summary exists). */
function buildAppendix(input: ReportInput, parts: ProcessPart[], model: EngineModel, stepName: Map<string, string>): AppendixView {
  const { bundle } = input;
  const sourceTitle = new Map(input.sources.map((s) => [s.id, s.title]));
  const assumptions: AppendixView["assumptions"] = [];
  const evidence: AppendixView["evidence"] = [];
  const conflicts: AppendixView["conflicts"] = [];
  const valueText = (col: (typeof EVIDENCE_COLUMNS)[number], v: number) => formatParameter(col, v);

  for (const part of parts) {
    const steps = [...part.steps].filter((s) => s.kind !== "start" && s.kind !== "end").sort((a, b) => a.name.localeCompare(b.name));
    for (const s of steps) {
      const where = parts.length > 1 ? `${part.process.name} · ${s.name}` : s.name;
      for (const col of EVIDENCE_COLUMNS) {
        const raw = (s as StepRow)[col];
        if (raw === null || raw === undefined) continue;
        const value = Number(raw);
        if (value === 0 && !openConflict(s, col)) continue;
        const entry = columnProvenance(s, col);
        const conflict = openConflict(s, col);
        const source = entry?.source ?? "estimated";
        const parameter = EVIDENCE_LABELS[col];
        if (conflict || isOpenAssumption(s, col) || source === "estimated") {
          assumptions.push({
            where,
            parameter,
            value: valueText(col, value),
            status: conflict ? "conflict" : isOpenAssumption(s, col) || s.assumption ? "assumption" : "estimate",
            note: entry?.note ?? null,
          });
        }
        for (const c of evidenceOf(s, col)) {
          evidence.push({
            where,
            parameter,
            quote: c.quote,
            speaker: c.speaker ?? null,
            source: sourceTitle.get(c.source_id) ?? "a deleted source",
            timestamp: c.timestamp ?? null,
          });
        }
        const recorded = entry?.conflict;
        if (recorded && Array.isArray(recorded.values) && recorded.values.length >= 2) {
          conflicts.push({
            where,
            parameter,
            values: recorded.values.map((v) => `${valueText(col, Number(v.value))}${v.speaker ? ` (${v.speaker})` : ""}`).join(" vs "),
            resolved: Boolean(recorded.resolved),
          });
        }
      }
    }
  }

  // Company-model values and engine defaults that are estimates (robustness perturbs these).
  const company: AppendixView["company"] = [];
  const src = (p: ProvenanceMap | undefined, col: string) => p?.[col]?.source ?? "estimated";
  const settings = bundle.workspace.settings;
  const rules = healthRules(model);
  const health: [string, keyof typeof DEFAULT_HEALTH_RULES, keyof typeof settings][] = [
    ["Starting health of a client with none entered", "initial", "health_initial"],
    ["Health recovered per task done on time", "recover", "health_recover"],
    ["Health lost per late task", "latePenalty", "health_late_penalty"],
    ["Health lost per missed task", "missedPenalty", "health_missed_penalty"],
  ];
  if (model.clients) {
    for (const [label, key, setting] of health) {
      const set = settings[setting] !== undefined;
      const s = set ? src(bundle.workspace.provenance, `settings.${String(setting)}`) : "estimated default";
      if (s !== "entered" && s !== "measured") company.push({ parameter: label, value: String(rules[key]), source: s });
    }
  }
  for (const svc of [...bundle.services].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))) {
    const cols: [string, string, string][] = [
      ["churn_monthly_base", "base churn a month", `${Math.round(Number(svc.churn_monthly_base) * 1000) / 10}%`],
      ["churn_health_sensitivity", "churn sensitivity to health", String(Number(svc.churn_health_sensitivity))],
      ["tenure_months", "typical tenure", `${Number(svc.tenure_months)} months`],
    ];
    for (const [col, label, value] of cols) {
      const s = src(svc.provenance, col);
      if (s === "estimated") company.push({ parameter: `${svc.name}: ${label}`, value, source: s });
    }
  }
  for (const l of [...(bundle.leadSources ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
    if (src(l.provenance, "volume_week") === "estimated") company.push({ parameter: `${l.name}: leads a week`, value: String(Number(l.volume_week)), source: "estimated" });
    if (src(l.provenance, "conversion_to_qualified") === "estimated")
      company.push({ parameter: `${l.name}: conversion to qualified`, value: `${Math.round(Number(l.conversion_to_qualified) * 100)}%`, source: "estimated" });
  }

  const citations = citationsBySource([
    ...parts.flatMap((p) => p.steps.map((s) => ({ table: "steps", id: s.id, name: stepName.get(s.id) ?? s.name, processId: s.process_id, revision: "live" as const, provenance: s.provenance }))),
    ...(bundle.leadSources ?? []).map((l) => ({ table: "lead_sources", id: l.id, name: l.name, provenance: l.provenance })),
  ]);
  const sources = [...input.sources]
    .sort((a, b) => (a.recorded_at ?? "").localeCompare(b.recorded_at ?? "") || a.title.localeCompare(b.title))
    .map((s) => ({ title: s.title, kind: s.kind, speakers: s.speakers, recordedAt: s.recorded_at, citations: citations.get(s.id)?.length ?? 0 }));

  return { assumptions, evidence, conflicts, sources, company, provenance: [] };
}

/**
 * The content with another executive summary (narration or an edit, #29):
 * the appendix's provenance and the methodology's note on who wrote the text
 * follow it.
 */
export function withSummary(content: ReportContent, summary: ExecutiveSummary): ReportContent {
  const c: ReportContent = { ...content, summary };
  if (c.appendix) c.appendix = { ...c.appendix, provenance: provenanceLines(c) };
  if (c.methodology) c.methodology = { paragraphs: [...c.methodology.paragraphs.slice(0, -1), textNote(c)] };
  return c;
}

/** Who produced what, for the appendix. */
function provenanceLines(c: ReportContent): string[] {
  const lines = [
    `Numbers: ${c.run.id ? `saved run “${c.run.name}” (${c.run.id})` : `run “${c.run.name}”`}, engine ${c.run.engineVersion}, ${c.run.reps} replications from seed ${c.run.seed}, starting ${c.run.startDate}.`,
    `Process revisions: ${c.run.revisions.map((r) => `${r.name} r${r.number}`).join(", ")}.`,
    `Generated ${formatDateTime(c.generatedAt)}${c.generatedBy ? ` by ${c.generatedBy}` : ""}.`,
  ];
  if (c.summary) lines.push(summaryProvenance(c.summary));
  return lines;
}
