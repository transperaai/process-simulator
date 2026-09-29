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
