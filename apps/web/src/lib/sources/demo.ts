// The public demo's Northbeam sample with sources in play (issue #21): Rosa's
// reading of the time logs disagrees with Maya on audits (a conflict, 2×
// apart, so a perception gap), and kickoff time is an assumption waiting to be
// confirmed. Built with the same rules the inspector uses.

import {
  applyStepPatch,
  citationsBySource,
  citeEvidence,
  northbeamBundle,
  northbeamSourceIds,
  northbeamSources,
  northbeamStepIds,
  type ProcessBundle,
  type SourceCitation,
  type SourceRow,
} from "@transpera-flow/db";

const AT = "2026-09-29T10:00:00.000Z";

export function demoBundle(): ProcessBundle {
  const bundle = northbeamBundle();
  const interview = northbeamSourceIds.strategyInterview;
  bundle.steps = bundle.steps.map((s) => {
    if (s.id === northbeamStepIds.audit) {
      return applyStepPatch(
        s,
        citeEvidence(
          s,
          "work_hours",
          {
            source_id: interview,
            speaker: "Rosa Diaz",
            quote: "From the time logs it looks more like twelve hours by the time it goes out.",
            timestamp: "00:16:40",
            value: 12,
          },
          { at: AT },
        ),
      );
    }
    if (s.id === northbeamStepIds.kickoff) {
      const cited = applyStepPatch(
        s,
        citeEvidence(s, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Kickoffs are quicker, half a day.", timestamp: "00:21:10", value: 4 }, { at: AT }),
      );
      const entry = cited.provenance.work_hours!;
      return { ...cited, provenance: { ...cited.provenance, work_hours: { ...entry, note: "“Half a day” read as 4 working hours." } } };
    }
    return s;
  });
  return bundle;
}

export function demoSources(): SourceRow[] {
  return northbeamSources();
}

/** What cites each demo source: the demo process's steps and its lead sources. */
export function demoCitations(bundle: ProcessBundle = demoBundle()): Record<string, SourceCitation[]> {
  return Object.fromEntries(
    citationsBySource([
      ...bundle.steps.map((s) => ({ table: "steps", id: s.id, name: s.name, processId: s.process_id, revision: "live" as const, provenance: s.provenance })),
      ...(bundle.leadSources ?? []).map((l) => ({ table: "lead_sources", id: l.id, name: l.name, provenance: l.provenance })),
    ]),
  );
}
