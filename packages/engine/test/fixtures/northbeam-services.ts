import { northbeamModel, type EngineModel } from "../../src";

/**
 * Northbeam with its two services: SEO and PPC retainers, the kickoff's
 * SEO/PPC branch condition-tagged so each client follows its service's path.
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
