import type { EngineModel } from "../model";

/**
 * Northbeam Digital: fictional SEO/PPC agency, lead-to-live pipeline.
 * The prototype's BASE_MODEL (minus canvas positions) with one change: 7 leads
 * a week, not 12. At 12 the lone strategist gets ~38h/week of audits and
 * kickoffs against ~30h left after client work, so the queue grows without
 * bound and every KPI depends on how long the warm-up ran. At 7 the strategist
 * is still the bottleneck (~82%) but the business reaches a steady state.
 * Times in working hours.
 */
export function northbeamModel(): EngineModel {
  return {
    horizonWeeks: 13,
    hoursPerWeek: 40,
    leadsPerWeek: 7,
    activeClients: 26,
    churnMonthly: 0.03,
    retainer: 3800,
    roles: {
      sales: { name: "Sales", count: 2, cost: 45, ongoing: 0 },
      strat: { name: "Strategist", count: 1, cost: 70, ongoing: 0.4 },
      am: { name: "Account manager", count: 2, cost: 55, ongoing: 1.6 },
      seo: { name: "SEO specialist", count: 3, cost: 50, ongoing: 2.4 },
      ppc: { name: "PPC specialist", count: 2, cost: 50, ongoing: 2.0 },
      fin: { name: "Finance", count: 1, cost: 40, ongoing: 0.3 },
    },
    entry: "qualify",
    sinks: { won: "won", lost: "lost" },
    steps: [
      { id: "qualify", name: "Qualify lead", role: "sales", work: 0.5, wait: 4, rework: 0, next: [{ to: "discovery", p: 0.55 }, { to: "lost", p: 0.45 }] },
      { id: "discovery", name: "Discovery call", role: "sales", work: 1.5, wait: 24, rework: 0, next: [{ to: "audit", p: 0.7 }, { to: "lost", p: 0.3 }] },
      { id: "audit", name: "Audit & proposal", role: "strat", work: 6, wait: 0, rework: 0.15, next: [{ to: "decision", p: 1 }] },
      { id: "decision", name: "Client decision", role: null, work: 0, wait: 40, rework: 0, next: [{ to: "onboard", p: 0.32 }, { to: "lost", p: 0.68 }] },
      { id: "onboard", name: "Contract & onboarding", role: "am", work: 3, wait: 16, rework: 0.1, next: [{ to: "kickoff", p: 1 }] },
      { id: "kickoff", name: "Kickoff & strategy", role: "strat", work: 4, wait: 8, rework: 0, next: [{ to: "seo", p: 0.55 }, { to: "ppc", p: 0.45 }] },
      { id: "seo", name: "SEO campaign setup", role: "seo", work: 10, wait: 8, rework: 0.1, next: [{ to: "live", p: 1 }] },
      { id: "ppc", name: "PPC campaign setup", role: "ppc", work: 8, wait: 8, rework: 0.1, next: [{ to: "live", p: 1 }] },
      { id: "live", name: "Go live & first report", role: "am", work: 2, wait: 0, rework: 0, next: [{ to: "won", p: 1 }] },
    ],
  };
}

/**
 * Northbeam with its two services, as seeded: SEO and PPC retainers, the
 * kickoff's SEO/PPC branch condition-tagged so each client follows its
 * service's path. `northbeamModel()` stays the services-free golden model
 * (every win priced at `retainer`), so the prototype-parity and
 * queueing-theory checks keep their exact reference.
 */
export function northbeamWithServices(): EngineModel {
  const base = northbeamModel();
  return {
    ...base,
    services: {
      seo: {
        name: "SEO retainer",
        pricingModel: "retainer",
        price: 3500,
        margin: 0.45,
        tenureMonths: 18,
        churnMonthly: 0.03,
        mixShare: 0.55,
        pathTags: ["seo"],
      },
      ppc: {
        name: "PPC management",
        pricingModel: "retainer",
        price: 4200,
        margin: 0.4,
        tenureMonths: 12,
        churnMonthly: 0.04,
        mixShare: 0.45,
        pathTags: ["ppc"],
      },
    },
    steps: base.steps.map((s) =>
      s.id === "kickoff"
        ? {
            ...s,
            next: [
              { to: "seo", p: 0.55, tag: "seo" },
              { to: "ppc", p: 0.45, tag: "ppc" },
            ],
          }
        : s,
    ),
  };
}

/** Northbeam's team (fictional), by key: name and role. */
export const NORTHBEAM_TEAM: [key: string, name: string, role: string][] = [
  ["priya", "Priya Shah", "sales"],
  ["tom", "Tom Reed", "sales"],
  ["maya", "Maya Collins", "strat"],
  ["leah", "Leah Brooks", "am"],
  ["dan", "Dan Okafor", "am"],
  ["sam", "Sam Patel", "seo"],
  ["chloe", "Chloe Evans", "seo"],
  ["arjun", "Arjun Mehta", "seo"],
  ["nina", "Nina Kowalski", "ppc"],
  ["ben", "Ben Carter", "ppc"],
  ["rosa", "Rosa Diaz", "fin"],
];

/** One client on Northbeam's roster, with the account manager and specialist(s) looking after it. */
export interface NorthbeamClient {
  name: string;
  services: ("seo" | "ppc")[];
  start: string;
  mrr: number;
  health: number;
  am: "leah" | "dan";
  seo?: "sam" | "chloe" | "arjun";
  ppc?: "nina" | "ben";
}

/**
 * Northbeam's 26 active clients (fictional): the prototype's `activeClients`,
 * named. Maya Collins (strategy) and Rosa Diaz (finance) look after everyone.
 * Nina Kowalski carries most of the PPC book, so a couple of PPC wins push
 * her client work past her week.
 */
export const NORTHBEAM_ROSTER: NorthbeamClient[] = [
  { name: "Harbour Lane Dental", services: ["seo"], start: "2023-02-01", mrr: 3500, health: 88, am: "leah", seo: "sam" },
  { name: "Fenwick & Co Solicitors", services: ["seo"], start: "2023-05-15", mrr: 4200, health: 82, am: "leah", seo: "sam" },
  { name: "Oakridge Garden Rooms", services: ["seo", "ppc"], start: "2023-06-01", mrr: 7700, health: 76, am: "leah", seo: "chloe", ppc: "nina" },
  { name: "Brightwater Physio", services: ["seo"], start: "2023-09-04", mrr: 2900, health: 91, am: "dan", seo: "arjun" },
  { name: "Greystone Kitchens", services: ["ppc"], start: "2023-10-02", mrr: 4600, health: 71, am: "dan", ppc: "nina" },
  { name: "Calder Valley Joinery", services: ["seo"], start: "2024-01-08", mrr: 3200, health: 84, am: "leah", seo: "chloe" },
  { name: "Lumen Eyewear", services: ["ppc"], start: "2024-02-05", mrr: 5200, health: 64, am: "dan", ppc: "nina" },
  { name: "Thistle Home Care", services: ["seo"], start: "2024-03-11", mrr: 3500, health: 79, am: "leah", seo: "sam" },
  { name: "Bramble & Oak Bakery", services: ["ppc"], start: "2024-04-02", mrr: 3400, health: 86, am: "leah", ppc: "ben" },
  { name: "Northgate Motors", services: ["seo", "ppc"], start: "2024-05-20", mrr: 8100, health: 58, am: "dan", seo: "sam", ppc: "nina" },
  { name: "Willow & Sage Interiors", services: ["seo"], start: "2024-06-03", mrr: 3100, health: 90, am: "leah", seo: "arjun" },
  { name: "Swift Courier Co", services: ["ppc"], start: "2024-07-01", mrr: 4200, health: 47, am: "dan", ppc: "nina" },
  { name: "Kestrel Accountancy", services: ["seo"], start: "2024-08-12", mrr: 3600, health: 83, am: "leah", seo: "chloe" },
  { name: "Elm Street Opticians", services: ["ppc"], start: "2024-09-02", mrr: 3900, health: 80, am: "dan", ppc: "ben" },
  { name: "Moorland Holiday Cottages", services: ["seo"], start: "2024-10-07", mrr: 3300, health: 77, am: "leah", seo: "sam" },
  { name: "Harper Solar", services: ["ppc"], start: "2024-11-04", mrr: 4800, health: 69, am: "dan", ppc: "nina" },
  { name: "Pennine Roofing", services: ["seo"], start: "2025-01-13", mrr: 3000, health: 85, am: "dan", seo: "arjun" },
  { name: "Nimbus Fitness", services: ["ppc"], start: "2025-02-03", mrr: 4100, health: 74, am: "leah", ppc: "ben" },
  { name: "Ashby Veterinary Group", services: ["seo", "ppc"], start: "2025-03-10", mrr: 7900, health: 81, am: "dan", seo: "chloe", ppc: "nina" },
  { name: "Riverside Pilates", services: ["seo"], start: "2025-04-07", mrr: 2800, health: 92, am: "leah", seo: "arjun" },
  { name: "Copperfield Furniture", services: ["ppc"], start: "2025-05-06", mrr: 4400, health: 66, am: "dan", ppc: "ben" },
  { name: "Hartley Estate Agents", services: ["seo"], start: "2025-06-02", mrr: 3700, health: 87, am: "leah", seo: "sam" },
  { name: "Birchwood Nurseries", services: ["seo"], start: "2025-08-04", mrr: 3400, health: 80, am: "dan", seo: "chloe" },
  { name: "Redwood Wedding Venue", services: ["ppc"], start: "2025-10-06", mrr: 4300, health: 78, am: "leah", ppc: "nina" },
  { name: "Coastline Kayak Hire", services: ["seo"], start: "2026-01-12", mrr: 3200, health: 89, am: "dan", seo: "sam" },
  { name: "Atlas Driving School", services: ["seo"], start: "2026-06-01", mrr: 3500, health: 93, am: "leah", seo: "arjun" },
];

/**
 * Fallback ongoing load per client a month, by role (docs/PRD.md §6.3.4),
 * sized so the roster's totals are close to the prototype's pooled load (26
 * clients × its hours per client a week in each role).
 */
export const NORTHBEAM_FALLBACK_LOAD: Record<"seo" | "ppc", Record<string, number>> = {
  seo: { strat: 1.5, am: 6, seo: 16, fin: 1.2 },
  ppc: { strat: 1.5, am: 6, ppc: 19, fin: 1.2 },
};

/** Client ids of the roster, in roster order ("c01" …). */
export const northbeamClientKey = (i: number) => `c${String(i + 1).padStart(2, "0")}`;

/**
 * Northbeam with services, named people and its client roster, as seeded
 * (issue #18): ongoing load comes from each client's services and goes to the
 * people assigned to it, and the workspace allows 10% overtime. Wins become
 * synthetic clients; clients churn one by one.
 */
export function northbeamWithClients(): EngineModel {
  const base = northbeamWithServices();
  const services = base.services!;
  const clients: NonNullable<EngineModel["clients"]> = {};
  NORTHBEAM_ROSTER.forEach((c, i) => {
    const assignments: Record<string, string> = { am: c.am, fin: "rosa", strat: "maya" };
    if (c.seo) assignments.seo = c.seo;
    if (c.ppc) assignments.ppc = c.ppc;
    clients[northbeamClientKey(i)] = { name: c.name, services: [...c.services].sort(), mrr: c.mrr, health: c.health, assignments };
  });
  return {
    ...base,
    activeClients: NORTHBEAM_ROSTER.length,
    services: {
      seo: { ...services.seo!, fallbackOngoing: NORTHBEAM_FALLBACK_LOAD.seo },
      ppc: { ...services.ppc!, fallbackOngoing: NORTHBEAM_FALLBACK_LOAD.ppc },
    },
    people: Object.fromEntries(NORTHBEAM_TEAM.map(([key, name, role]) => [key, { name, roles: [role], capacity: base.hoursPerWeek }])),
    overtimeCap: 0.1,
    clients,
  };
}
