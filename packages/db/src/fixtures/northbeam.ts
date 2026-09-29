import type { EdgeRow, PersonRoleRow, PersonRow, ProcessBundle, RoleRow, StepRow, WorkspaceAccess } from "../types";

// Northbeam Digital, the prototype's sample agency, as database rows. Ids are
// fixed so the seed is reproducible, and they sort in the prototype's order so
// the resolved engine model matches the engine's northbeamModel() exactly.

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
});

let edgeN = 0;
const edge = (from: StepKey, to: StepKey, probability: number): EdgeRow => ({
  id: id("f", ++edgeN),
  revision_id: rev,
  workspace_id: ws,
  process_id: proc,
  from_step_id: northbeamStepIds[from],
  to_step_id: northbeamStepIds[to],
  probability,
  condition_tag: null,
  label: null,
});

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
      edge("kickoff", "seo", 0.55),
      edge("kickoff", "ppc", 0.45),
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
