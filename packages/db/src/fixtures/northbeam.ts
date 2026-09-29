import type {
  DemandSettingsRow,
  EdgeRow,
  IssueRow,
  LeadSourceRow,
  PersonRoleRow,
  PersonRow,
  ProcessBundle,
  Provenance,
  RoleRow,
  ScenarioRow,
  ServiceRow,
  StepRow,
  WorkspaceAccess,
} from "../types";

// Northbeam Digital, the prototype's sample agency, as database rows. Ids are
// fixed so the seed is reproducible, and they sort in the prototype's order so
// the resolved engine model matches the engine's northbeamWithServices()
// exactly (and, without the services, its golden northbeamModel()).

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const NORTHBEAM_WORKSPACE_ID = id("a", 1);
export const NORTHBEAM_PROCESS_ID = id("c", 1);
export const NORTHBEAM_REVISION_ID = id("d", 1);

const ws = NORTHBEAM_WORKSPACE_ID;
const proc = NORTHBEAM_PROCESS_ID;
const rev = NORTHBEAM_REVISION_ID;

export const northbeamRoleIds = {
  sales: id("b", 1),
  strat: id("b", 2),
  am: id("b", 3),
  seo: id("b", 4),
  ppc: id("b", 5),
  fin: id("b", 6),
} as const;

export const northbeamStepIds = {
  qualify: id("e", 1),
  discovery: id("e", 2),
  audit: id("e", 3),
  decision: id("e", 4),
  onboard: id("e", 5),
  kickoff: id("e", 6),
  seo: id("e", 7),
  ppc: id("e", 8),
  live: id("e", 9),
  start: id("e", 10),
  won: id("e", 11),
  lost: id("e", 12),
} as const;

/** Named people matching the prototype's head-counts (fictional). */
const PEOPLE: [RoleKey, string][] = [
  ["sales", "Priya Shah"],
  ["sales", "Tom Reed"],
  ["strat", "Maya Collins"],
  ["am", "Leah Brooks"],
  ["am", "Dan Okafor"],
  ["seo", "Sam Patel"],
  ["seo", "Chloe Evans"],
  ["seo", "Arjun Mehta"],
  ["ppc", "Nina Kowalski"],
  ["ppc", "Ben Carter"],
  ["fin", "Rosa Diaz"],
];

export const northbeamPersonIds: Record<string, string> = Object.fromEntries(
  PEOPLE.map(([, name], i) => [name, id("9", i + 1)]),
);

type RoleKey = keyof typeof northbeamRoleIds;
type StepKey = keyof typeof northbeamStepIds;

const role = (key: RoleKey, name: string, headcount: number, cost: number, ongoing: number, color: string): RoleRow => ({
  id: northbeamRoleIds[key],
  workspace_id: ws,
  name,
  color,
  default_cost_rate: cost,
  headcount,
  ongoing_hours_per_client_week: ongoing,
});

const step = (
  key: StepKey,
  name: string,
  roleKey: RoleKey | null,
  work: number,
  wait: number,
  rework: number,
  tool: string | null,
  x: number,
  y: number,
  kind: StepRow["kind"] = roleKey ? "task" : "decision",
): StepRow => ({
  id: northbeamStepIds[key],
  revision_id: rev,
  workspace_id: ws,
  process_id: proc,
  name,
  kind,
  outcome: kind === "end" ? (key as "won" | "lost") : null,
  role_id: roleKey ? northbeamRoleIds[roleKey] : null,
  person_id: null,
  work_hours: work,
  work_dist: "lognormal",
  work_params: {},
  wait_hours: wait,
  wait_dist: "lognormal",
  wait_params: {},
  rework_rate: rework,
  rework_to_step_id: null,
  tool,
  notes: null,
  sla_hours: null,
  current_wip: null,
  x,
  y,
  assumption: false,
});

let edgeN = 0;
const edge = (from: StepKey, to: StepKey, probability: number, tag: string | null = null): EdgeRow => ({
  id: id("f", ++edgeN),
  revision_id: rev,
  workspace_id: ws,
  process_id: proc,
  from_step_id: northbeamStepIds[from],
  to_step_id: northbeamStepIds[to],
  probability,
  condition_tag: tag,
  label: null,
});

/** Ids sort in the engine fixture's order (seo, ppc). */
export const northbeamServiceIds = {
  seo: id("8", 1),
  ppc: id("8", 2),
} as const;

/** SEO and PPC retainers, as in the engine's northbeamWithServices(). */
function services(): ServiceRow[] {
  const service = (
    key: keyof typeof northbeamServiceIds,
    name: string,
    price: number,
    margin: number,
    tenure: number,
    churn: number,
    mix: number,
  ): ServiceRow => ({
    id: northbeamServiceIds[key],
    workspace_id: ws,
    name,
    pricing_model: "retainer",
    price,
    margin,
    tenure_months: tenure,
    churn_monthly_base: churn,
    mix_share: mix,
    entry_process_id: proc,
    path_tags: [key],
    active: true,
  });
  return [
    service("seo", "SEO retainer", 3500, 0.45, 18, 0.03, 0.55),
    service("ppc", "PPC management", 4200, 0.4, 12, 0.04, 0.45),
  ];
}

/** Ids sort in the order below. */
export const northbeamLeadSourceIds = {
  website: id("6", 1),
  ads: id("6", 2),
  referrals: id("6", 3),
} as const;

/** The sample figures are estimates, as an audit's first pass would be. */
const ESTIMATE: Provenance = { source: "estimated", at: "2026-09-29T00:00:00Z", note: "Northbeam sample data" };

/**
 * Lead sources whose qualified leads add up to the 7 a week Northbeam has
 * always simulated: 8 × 25% + 4 × 50% + 3 × 100% = 2 + 2 + 3 (exact in
 * binary floating point, so the rate is exactly 7). No seasonality and no
 * growth, so arrivals are unchanged.
 */
function leadSources(): LeadSourceRow[] {
  const source = (key: keyof typeof northbeamLeadSourceIds, name: string, volume: number, conversion: number): LeadSourceRow => ({
    id: northbeamLeadSourceIds[key],
    workspace_id: ws,
    name,
    volume_week: volume,
    conversion_to_qualified: conversion,
    provenance: { volume_week: ESTIMATE, conversion_to_qualified: ESTIMATE },
  });
  return [
    source("website", "Website enquiries", 8, 0.25),
    source("ads", "Google Ads", 4, 0.5),
    source("referrals", "Client referrals", 3, 1),
  ];
}

function demandSettings(): DemandSettingsRow {
  return { workspace_id: ws, growth_monthly: 0, provenance: { growth_monthly: ESTIMATE } };
}

export function northbeamBundle(): ProcessBundle {
  edgeN = 0;
  return {
    workspace: {
      id: ws,
      name: "Northbeam Digital",
      slug: "northbeam",
      settings: {
        hours_per_week: 40,
        horizon_weeks: 13,
        currency: "GBP",
        leads_per_week: 7,
        active_clients: 26,
        churn_monthly: 0.03,
        retainer: 3800,
      },
    },
    roles: [
      role("sales", "Sales", 2, 45, 0, "#2a78d6"),
      role("strat", "Strategist", 1, 70, 0.4, "#eb6834"),
      role("am", "Account manager", 2, 55, 1.6, "#1baf7a"),
      role("seo", "SEO specialist", 3, 50, 2.4, "#8b5cf6"),
      role("ppc", "PPC specialist", 2, 50, 2.0, "#d4a106"),
      role("fin", "Finance", 1, 40, 0.3, "#64748b"),
    ],
    process: {
      id: proc,
      workspace_id: ws,
      name: "Lead to live",
      kind: "pipeline",
      entity_name: "lead",
      description: "From inbound lead to a live SEO or PPC campaign.",
      live_revision_id: rev,
    },
    revision: { id: rev, workspace_id: ws, process_id: proc, number: 1, status: "published" },
    steps: [
      step("qualify", "Qualify lead", "sales", 0.5, 4, 0, "HubSpot", 60, 50),
      step("discovery", "Discovery call", "sales", 1.5, 24, 0, "Zoom + HubSpot", 290, 50),
      step("audit", "Audit & proposal", "strat", 6, 0, 0.15, "SEMrush, Google Docs", 520, 50),
      step("decision", "Client decision", null, 0, 40, 0, "Email", 750, 50),
      step("onboard", "Contract & onboarding", "am", 3, 16, 0.1, "PandaDoc, Notion", 60, 290),
      step("kickoff", "Kickoff & strategy", "strat", 4, 8, 0, "Notion", 290, 290),
      step("seo", "SEO campaign setup", "seo", 10, 8, 0.1, "Ahrefs, WordPress", 520, 230),
      step("ppc", "PPC campaign setup", "ppc", 8, 8, 0.1, "Google Ads", 520, 340),
      step("live", "Go live & first report", "am", 2, 0, 0, "Looker Studio", 750, 290),
      step("start", "Lead arrives", null, 0, 0, 0, null, -150, 50, "start"),
      step("won", "Won", null, 0, 0, 0, null, 980, 290, "end"),
      step("lost", "Lost", null, 0, 0, 0, null, 640, 170, "end"),
    ],
    edges: [
      edge("start", "qualify", 1),
      edge("qualify", "discovery", 0.55),
      edge("qualify", "lost", 0.45),
      edge("discovery", "audit", 0.7),
      edge("discovery", "lost", 0.3),
      edge("audit", "decision", 1),
      edge("decision", "onboard", 0.32),
      edge("decision", "lost", 0.68),
      edge("onboard", "kickoff", 1),
      edge("kickoff", "seo", 0.55, "seo"),
      edge("kickoff", "ppc", 0.45, "ppc"),
      edge("seo", "live", 1),
      edge("ppc", "live", 1),
      edge("live", "won", 1),
    ],
    people: PEOPLE.map(
      ([, name]): PersonRow => ({
        id: northbeamPersonIds[name]!,
        workspace_id: ws,
        name,
        fte: 1,
        capacity_hours_week: null,
        cost_rate: null,
        active: true,
        start_date: null,
        end_date: null,
      }),
    ),
    personRoles: PEOPLE.map(
      ([roleKey, name]): PersonRoleRow => ({
        person_id: northbeamPersonIds[name]!,
        role_id: northbeamRoleIds[roleKey],
        workspace_id: ws,
      }),
    ),
    personSkills: [],
    personLeave: [],
    services: services(),
    leadSources: leadSources(),
    seasonality: [],
    demand: demandSettings(),
  };
}

export const NORTHBEAM_DOMAIN = "northbeam.example";

/** Example access settings (fictional; `.example` and example.com never receive mail). */
export function northbeamAccess(): WorkspaceAccess {
  const person = (name: string) => northbeamPersonIds[name]!;
  return {
    domains: [{ id: id("7", 1), workspace_id: ws, domain: NORTHBEAM_DOMAIN }],
    emails: [
      { id: id("7", 2), workspace_id: ws, email: "rosa.diaz@northbeam.example", role: "owner", person_id: person("Rosa Diaz") },
      { id: id("7", 3), workspace_id: ws, email: "leah.brooks@northbeam.example", role: "editor", person_id: person("Leah Brooks") },
      // A contractor on a personal address: only the pre-assigned list can let them in.
      { id: id("7", 4), workspace_id: ws, email: "sam.patel.seo@example.com", role: "member", person_id: person("Sam Patel") },
    ],
  };
}

/**
 * Northbeam's scenario library: the four every workspace starts with (hire,
 * automate a step, more leads, downturn; see the scenarios migration), aimed
 * at Northbeam's own bottleneck. The seed replaces the generic versions the
 * workspace trigger created with these.
 */
export function northbeamScenarios(): ScenarioRow[] {
  const scenario = (n: number, name: string, description: string, patch: ScenarioRow["patch"]): ScenarioRow => ({
    id: id("6", n),
    workspace_id: ws,
    name,
    description,
    patch,
    parent_scenario_id: null,
  });
  return [
    scenario(1, "Hire a strategist", "A second full-time strategist to share audits, proposals and kickoffs.", [
      { path: `roles.${northbeamRoleIds.strat}.headcount`, op: "add", value: 1 },
    ]),
    scenario(2, "Automate proposals", "Templates and SEMrush exports cut hands-on time on audits and proposals by 60%.", [
      { path: `steps.${northbeamStepIds.audit}.work_hours`, op: "multiply", value: 0.4 },
    ]),
    scenario(3, "More leads", "25% more leads every week.", [{ path: "demand.leads_per_week", op: "multiply", value: 1.25 }]),
    scenario(4, "Downturn", "30% fewer leads a week, and client churn up by half.", [
      { path: "demand.leads_per_week", op: "multiply", value: 0.7 },
      { path: "demand.churn_monthly", op: "multiply", value: 1.5 },
    ]),
  ];
}

/**
 * Northbeam's register as the audit left it (after the prototype's findings):
 * two audit findings logged by hand, one linked to its fix, and the detected
 * single point of failure at audits promoted to a tracked issue, so each run
 * lists it once, as tracked.
 */
export function northbeamIssues(): IssueRow[] {
  const at = "2026-09-29T09:00:00Z";
  const base = {
    workspace_id: ws,
    process_id: proc,
    role_id: null,
    person_id: null,
    evidence_metrics: {},
    owner_person_id: null,
    scenario_id: null,
    detected_key: null,
    resolved_at: null,
    created_at: at,
    updated_at: at,
  } satisfies Partial<IssueRow>;
  const scenario = (n: number) => northbeamScenarios()[n - 1]!.id;
  const person = (name: string) => northbeamPersonIds[name]!;
  return [
    {
      ...base,
      id: id("8", 1),
      step_id: northbeamStepIds.audit,
      role_id: northbeamRoleIds.strat,
      type: "manual",
      severity: "serious",
      title: "Every proposal is built by hand",
      evidence: "Audit interview, 12 Sep: 5–8 hours per proposal, and 15% go back for rework after sales review.",
      owner_person_id: person("Rosa Diaz"),
      status: "open",
      scenario_id: scenario(2),
      source: "manual",
    },
    {
      ...base,
      id: id("8", 2),
      step_id: northbeamStepIds.audit,
      role_id: northbeamRoleIds.strat,
      person_id: person("Maya Collins"),
      type: "spof",
      severity: "serious",
      title: "Only Maya Collins can do Audit & proposal",
      evidence: "Detected: nobody else can pick up audits when Maya is away. Proposals stalled for 9 days in July.",
      owner_person_id: person("Rosa Diaz"),
      status: "in_progress",
      scenario_id: scenario(1),
      source: "promoted",
      detected_key: `spof:step:${northbeamStepIds.audit}`,
    },
    {
      ...base,
      id: id("8", 3),
      step_id: northbeamStepIds.qualify,
      role_id: northbeamRoleIds.sales,
      type: "idea",
      severity: "info",
      title: "Lead scoring could skip unqualified discovery calls",
      evidence: "45% of leads drop out at qualification but still get a 4-hour response.",
      owner_person_id: person("Priya Shah"),
      status: "open",
      source: "manual",
    },
  ];
}
