import { describe, expect, it } from "vitest";
import {
  companyOf,
  northbeamBundle,
  northbeamClientIds,
  northbeamLeadSourceIds,
  northbeamPersonIds,
  northbeamRoleIds,
  northbeamServiceIds,
  northbeamSourceIds,
} from "@transpera-flow/db";
import {
  buildClientSuggestion,
  buildCompanySuggestion,
  buildDemandSuggestions,
  buildPersonSuggestion,
  buildServiceSuggestion,
  matchForUpsert,
} from "../src";
import { ToolError } from "../src/result";

// What the company tools suggest (issue #25): names resolve to ids, only real
// changes are suggested, and ambiguous names return candidates.

const model = () => companyOf(northbeamBundle());
const evidence = [{ source_id: northbeamSourceIds.salesNotes, speaker: "Priya Shah", quote: "fifteen a week from ads" }];
const sam = northbeamPersonIds["Sam Patel"]!;

const fails = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe(code);
    return err as ToolError;
  }
  throw new Error("expected a ToolError");
};

describe("matchForUpsert", () => {
  const items = [
    { id: "1", name: "Google Ads" },
    { id: "2", name: "Google Ads (display)" },
    { id: "3", name: "Website enquiries" },
  ];
  it("updates an exact match by name (any case) or id, and adds a name nothing resembles", () => {
    expect(matchForUpsert(items, "google ads", "lead source")?.id).toBe("1");
    expect(matchForUpsert(items, "3", "lead source")?.id).toBe("3");
    expect(matchForUpsert(items, "Podcast", "lead source")).toBeNull();
  });
  it("refuses a partial match with the candidates, unless create is set", () => {
    const err = fails(() => matchForUpsert(items, "website", "lead source"), "ambiguous");
    expect(err.candidates).toEqual([{ id: "3", name: "Website enquiries" }]);
    expect(matchForUpsert(items, "website", "lead source", true)).toBeNull();
  });
});

describe("set_company", () => {
  it("suggests only the settings that differ", () => {
    const built = buildCompanySuggestion(model(), { hours_per_week: 37.5, overtime_cap: 0.1, currency: undefined }, { evidence });
    expect(built.proposals).toEqual([{ target_table: "workspaces", target_id: null, patch: { set: { hours_per_week: 37.5 } }, evidence, note: null }]);
    expect(built.unchanged).toEqual(["Company settings: overtime_cap is already 0.1"]);
    expect(buildCompanySuggestion(model(), { hours_per_week: 40 }, {}).proposals).toEqual([]);
  });
});

describe("upsert_service", () => {
  it("updates a service by name and adds a new one with its defaults listed as assumptions", () => {
    const assumptions: string[] = [];
    const update = buildServiceSuggestion(model(), { name: "seo retainer", price: 3800, margin: 0.45 }, assumptions);
    expect(update.proposals[0]).toMatchObject({ target_table: "services", target_id: northbeamServiceIds.seo, patch: { set: { price: 3800 } } });
    expect(update.unchanged).toEqual(["Service SEO retainer: margin is already 0.45"]);
    const add = buildServiceSuggestion(model(), { name: "Content marketing", price: 2000, note: "Mentioned as a new line" }, assumptions);
    expect(add.proposals[0]).toMatchObject({ target_id: null, patch: { set: { name: "Content marketing", price: 2000 } }, note: "Mentioned as a new line" });
    expect(assumptions.join(" ")).toMatch(/pricing_model not given, so it will default to retainer/);
  });
});

describe("upsert_person", () => {
  it("resolves roles by name and suggests only what changes", () => {
    const built = buildPersonSuggestion(model(), { name: "Sam Patel", fte: 0.8, roles: ["SEO specialist", "ppc specialist"] }, []);
    expect(built.proposals[0]).toMatchObject({
      target_table: "people",
      target_id: sam,
      patch: { set: { fte: 0.8 }, roles: [northbeamRoleIds.seo, northbeamRoleIds.ppc] },
    });
    const same = buildPersonSuggestion(model(), { name: "Sam Patel", roles: ["SEO specialist"] }, []);
    expect(same).toEqual({ proposals: [], unchanged: ["Person Sam Patel: roles are already SEO specialist"] });
  });

  it("adds a new person with leave, and refuses an unknown role with the list", () => {
    const assumptions: string[] = [];
    const built = buildPersonSuggestion(
      model(),
      { name: "Jo Smith", roles: ["Account manager"], leave: [{ start_date: "2026-12-21", end_date: "2027-01-01" }] },
      assumptions,
    );
    expect(built.proposals[0]!.patch).toEqual({
      set: { name: "Jo Smith" },
      roles: [northbeamRoleIds.am],
      leave: [{ start_date: "2026-12-21", end_date: "2027-01-01", note: null }],
    });
    expect(assumptions).toEqual(["New person 'Jo Smith': fte not given, so it will default to 1."]);
    const err = fails(() => buildPersonSuggestion(model(), { name: "Jo Smith", roles: ["Copywriter"] }, []), "not_found");
    expect(err.candidates!.length).toBe(6);
  });

  it("returns candidates for a name that only partly matches", () => {
    fails(() => buildPersonSuggestion(model(), { name: "Sam", fte: 1 }, []), "ambiguous");
  });
});

describe("upsert_client", () => {
  it("reassigns by role and person name, sets services, and notes a person without the role", () => {
    const assumptions: string[] = [];
    const built = buildClientSuggestion(
      model(),
      { name: "Harbour Lane Dental", mrr: 4000, services: ["SEO retainer", "PPC management"], assignments: { "PPC specialist": "Sam Patel", "SEO specialist": "Sam Patel" } },
      assumptions,
    );
    expect(built.proposals[0]).toMatchObject({
      target_id: northbeamClientIds.c01,
      patch: { set: { mrr: 4000 }, services: [northbeamServiceIds.seo, northbeamServiceIds.ppc], assignments: { [northbeamRoleIds.ppc]: sam } },
    });
    expect(built.unchanged).toEqual(["Client Harbour Lane Dental: SEO specialist is already Sam Patel"]);
    expect(assumptions).toEqual(["Sam Patel doesn't have the PPC specialist role; they're suggested for it anyway."]);
  });
});

describe("set_demand", () => {
  it("makes one suggestion per lead source, seasonality month and growth, with per-item evidence", () => {
    const own = [{ source_id: northbeamSourceIds.strategyInterview, quote: "referrals are drying up" }];
    const built = buildDemandSuggestions(
      model(),
      {
        lead_sources: [
          { name: "Google Ads", volume_week: 15 },
          { name: "Client referrals", volume_week: 2, evidence: own },
          { name: "Podcast", volume_week: 1 },
        ],
        seasonality: [{ month: 12, multiplier: 0.6 }, { month: 6, multiplier: 1 }],
        growth_monthly: 0.02,
        evidence,
      },
      [],
    );
    expect(built.proposals.map((p) => [p.target_table, p.target_id, p.patch.set, p.evidence])).toEqual([
      ["lead_sources", northbeamLeadSourceIds.ads, { volume_week: 15 }, evidence],
      ["lead_sources", northbeamLeadSourceIds.referrals, { volume_week: 2 }, own],
      ["lead_sources", null, { name: "Podcast", volume_week: 1 }, evidence],
      ["seasonality", null, { month: 12, multiplier: 0.6 }, evidence],
      ["demand_settings", null, { growth_monthly: 0.02 }, evidence],
    ]);
    expect(built.unchanged).toEqual(["Seasonality in June: already ×1"]);
  });

  it("takes twelve multipliers, January first, and skips months already at that value", () => {
    const curve = [1, 1, 1, 1, 1, 1, 0.8, 0.8, 1, 1, 1, 0.6];
    const built = buildDemandSuggestions(model(), { seasonality: curve }, []);
    expect(built.proposals.map((p) => p.patch.set)).toEqual([
      { month: 7, multiplier: 0.8 },
      { month: 8, multiplier: 0.8 },
      { month: 12, multiplier: 0.6 },
    ]);
  });
});
