// The public demo's company-model suggestions and saved run (issue #25):
// what Claude might have suggested after Northbeam's audit interviews (the
// quotes are fictional, like the sample), and a run saved before some of the
// model changed, so its "model changed since this run" banner has something
// to list. Accepting a suggestion on /demo/suggestions changes the model the
// demo's saved runs are compared with (lib/demo/company-store.ts).

import {
  companyOf,
  NORTHBEAM_WORKSPACE_ID,
  northbeamBundle,
  northbeamLeadSourceIds,
  northbeamPersonIds,
  northbeamServiceIds,
  northbeamSourceIds,
  snapshotModel,
  type CompanyModel,
  type ModelSnapshot,
  type ProcessBundle,
  type SnapshotProcess,
  type SuggestionPatch,
  type SuggestionRow,
  type SuggestionTarget,
} from "@transpera-flow/db";

const id = (n: number) => `5a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (name: string) => northbeamPersonIds[name]!;
const { salesNotes, strategyInterview } = northbeamSourceIds;

function row(
  n: number,
  target: SuggestionTarget,
  targetId: string | null,
  patch: SuggestionPatch,
  extra: Partial<SuggestionRow> = {},
): SuggestionRow {
  return {
    id: id(n),
    workspace_id: NORTHBEAM_WORKSPACE_ID,
    target_table: target,
    target_id: targetId,
    patch,
    evidence: [],
    note: null,
    status: "pending",
    created_via: "mcp",
    applied: null,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: `2026-09-30T09:${String(10 + n).padStart(2, "0")}:00.000Z`,
    created_by: null,
    ...extra,
  };
}

/** Northbeam's sample suggestions: pending ones to review, and one already turned down. */
export function demoSuggestions(): SuggestionRow[] {
  return [
    row(1, "lead_sources", northbeamLeadSourceIds.ads, { set: { volume_week: 6 } }, {
      evidence: [{ source_id: salesNotes, speaker: "Priya Shah", quote: "Ads are nearer six a week since we raised the budget.", timestamp: null, value: 6 }],
      note: "Priya's figure for leads from Google Ads since the budget went up.",
    }),
    row(2, "people", person("Arjun Mehta"), { set: { fte: 0.8 } }, {
      evidence: [{ source_id: strategyInterview, speaker: "Maya Collins", quote: "Arjun moves to four days a week from November.", timestamp: "00:25:30", value: 0.8 }],
      note: "Four days out of five.",
    }),
    row(3, "people", person("Leah Brooks"), { set: { fte: 0.9 } }, {
      evidence: [{ source_id: strategyInterview, speaker: "Maya Collins", quote: "Leah drops a half day a week from November.", timestamp: "00:27:10", value: 0.9 }],
      note: "Nine tenths of a full-time week.",
    }),
    row(4, "services", northbeamServiceIds.seo, { set: { price: 3700 } }, {
      evidence: [{ source_id: salesNotes, speaker: "Tom Reed", quote: "New SEO clients are on 3,700 now.", timestamp: null, value: 3700 }],
    }),
    row(5, "services", northbeamServiceIds.ppc, { set: { price: 4500 } }, {
      evidence: [{ source_id: salesNotes, speaker: "Tom Reed", quote: "New PPC clients are on 4,500 now.", timestamp: null, value: 4500 }],
    }),
    row(6, "workspaces", null, { set: { overtime_cap: 0.15 } }, {
      note: "Maya said people “stay late most weeks”; 15% of capacity is a guess, not a figure anyone gave.",
    }),
    row(7, "seasonality", null, { set: { month: 12, multiplier: 0.6 } }, {
      evidence: [{ source_id: salesNotes, speaker: "Priya Shah", quote: "December is dead, maybe half the usual enquiries.", timestamp: null, value: 0.5 }],
      note: "“Maybe half”: 0.6 allows for the ones that still come in.",
    }),
    row(8, "demand_settings", null, { set: { growth_monthly: 0.02 } }, {
      evidence: [{ source_id: strategyInterview, speaker: "Maya Collins", quote: "We're growing a couple of percent a month, give or take.", timestamp: "00:31:02", value: 0.02 }],
    }),
    row(9, "lead_sources", northbeamLeadSourceIds.referrals, { set: { volume_week: 5 } }, {
      evidence: [{ source_id: salesNotes, speaker: "Tom Reed", quote: "Referrals were five a week in August.", timestamp: null, value: 5 }],
      status: "rejected",
      review_note: "August was a one-off; three a week is right.",
      reviewed_at: "2026-09-30T10:05:00.000Z",
      created_at: "2026-09-30T09:05:00.000Z",
    }),
  ];
}

/** The process revision the demo's runs use. */
export function demoProcesses(bundle: ProcessBundle = northbeamBundle()): SnapshotProcess[] {
  return [{ id: bundle.process.id, name: bundle.process.name, revision_id: bundle.revision.id, revision: bundle.revision.number }];
}

/** The model the demo starts with. */
export function demoCompany(): CompanyModel {
  return companyOf(northbeamBundle());
}

/**
 * The snapshot of the demo's saved "Audit baseline" run: the model two days
 * before, when overtime wasn't allowed, the SEO retainer was 3,300, Google Ads
 * brought 3 leads a week and Chloe Evans hadn't joined.
 */
export function demoBaselineSnapshot(): ModelSnapshot {
  const m = demoCompany();
  const chloe = person("Chloe Evans");
  const earlier: CompanyModel = {
    ...m,
    workspace: { ...m.workspace, settings: { ...m.workspace.settings, overtime_cap: 0 } },
    services: m.services.map((s) => (s.id === northbeamServiceIds.seo ? { ...s, price: 3300 } : s)),
    leadSources: m.leadSources.map((l) => (l.id === northbeamLeadSourceIds.ads ? { ...l, volume_week: 3 } : l)),
    people: m.people.filter((p) => p.id !== chloe),
    personRoles: m.personRoles.filter((r) => r.person_id !== chloe),
  };
  return snapshotModel(earlier, demoProcesses());
}
