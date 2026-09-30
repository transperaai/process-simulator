"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createReportLink } from "@/app/w/[slug]/reports/actions";
import { REPORT_SECTIONS, sectionLabel, type ReportSectionId } from "@/lib/report/content";
import { REPORT_DEFAULT_REPS, REPORT_MAX_REPS, REPORT_MAX_SCENARIOS } from "@/lib/report/options";
import type { BuilderRun, BuilderScenario, StoredReport } from "@/lib/report/page-data";

// The report builder (issue #28; docs/PRD.md §8 screen 12): choose the
// sections and the scenarios to compare, and the run behind the numbers,
// before generating. Live: one request that runs everything on the server
// and prints the PDF. Demo: a plain form that opens the printable report or
// the PDF for the Northbeam sample.

const box = "rounded-token border border-line bg-panel p-3 shadow-token";
const button = "rounded-token border border-line bg-panel px-3 py-1.5 font-semibold hover:bg-panel-2 disabled:opacity-50";
const primary = "rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50";

function SectionPicker({ selected, onChange }: { selected: Set<ReportSectionId>; onChange?: (next: Set<ReportSectionId>) => void }) {
  return (
    <fieldset className={box}>
      <legend className="px-1 text-sm font-bold">Sections</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {REPORT_SECTIONS.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sections"
              value={s.id}
              disabled={!s.optional}
              checked={selected.has(s.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(s.id);
                else next.delete(s.id);
                onChange?.(next);
              }}
            />
            {s.label}
            {!s.optional && <span className="text-fg-3">(always)</span>}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-fg-3">Client health prints only with a client roster; scenarios and robustness only with a scenario chosen.</p>
    </fieldset>
  );
}

function ScenarioPicker({ scenarios, selected, onChange }: { scenarios: BuilderScenario[]; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  return (
    <fieldset className={box}>
      <legend className="px-1 text-sm font-bold">Scenarios to compare</legend>
      {scenarios.length === 0 ? (
        <p className="text-sm text-fg-2">No saved scenarios yet. Save one from the process page to compare it here.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {scenarios.map((s) => (
            <li key={s.id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="scenarios"
                  value={s.id}
                  className="mt-1"
                  disabled={Boolean(s.needsAttention) || (!selected.has(s.id) && selected.size >= REPORT_MAX_SCENARIOS)}
                  checked={selected.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    onChange(next);
                  }}
                />
                <span>
                  <span className="font-semibold">{s.name}</span>
                  {s.description && <span className="text-fg-2"> · {s.description}</span>}
                  {s.needsAttention && <span className="block text-xs text-crit">Needs attention: {s.needsAttention}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-fg-3">
        Robustness runs automatically for each scenario (reusing earlier checks of the same model). At most {REPORT_MAX_SCENARIOS}.
      </p>
    </fieldset>
  );
}

type Outcome =
  | { tone: "busy" }
  | { tone: "error"; message: string }
  | { tone: "ok"; id: string; url: string; pdf: boolean; pdfError: string | null; omitted: { section: string; reason: string }[]; excluded: { name: string; reason: string }[] };

/** The live builder: generates on the server as the signed-in user. */
export function ReportBuilder({
  slug,
  processId,
  scenarios,
  runs,
}: {
  slug: string;
  processId: string;
  scenarios: BuilderScenario[];
  runs: BuilderRun[];
}) {
  const router = useRouter();
  const [sections, setSections] = useState(() => new Set<ReportSectionId>(REPORT_SECTIONS.map((s) => s.id)));
  const [chosen, setChosen] = useState(() => new Set<string>());
  const [runId, setRunId] = useState("");
  const [reps, setReps] = useState(REPORT_DEFAULT_REPS);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const generate = async () => {
    setOutcome({ tone: "busy" });
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processId, runId: runId || null, reps, sections: [...sections], scenarioIds: [...chosen] }),
      });
      const body = await res.json().catch(() => null);
      if (!body || body.status !== "ok") {
        setOutcome({ tone: "error", message: body?.message ?? `The report couldn't be generated (${res.status}).` });
        return;
      }
      setOutcome({ tone: "ok", id: body.id, url: body.url, pdf: body.pdf, pdfError: body.pdfError, omitted: body.omitted, excluded: body.excludedScenarios });
      router.refresh();
    } catch {
      setOutcome({ tone: "error", message: "The request failed. Check your connection and try again." });
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <SectionPicker selected={sections} onChange={setSections} />
        <ScenarioPicker scenarios={scenarios} selected={chosen} onChange={setChosen} />
      </div>
      <fieldset className={box}>
        <legend className="px-1 text-sm font-bold">The run behind the numbers</legend>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select value={runId} onChange={(e) => setRunId(e.target.value)} className="rounded-token border border-line bg-panel px-2 py-1">
            <option value="">A new run of the live model (saved with the report)</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id} disabled={r.changes > 0}>
                {r.name} · {r.reps} reps{r.changes > 0 ? ` · model changed since (${r.changes})` : ""}
              </option>
            ))}
          </select>
          {!runId && (
            <label className="flex items-center gap-2">
              <span className="text-fg-2">Replications</span>
              <input
                type="number"
                min={1}
                max={REPORT_MAX_REPS}
                value={reps}
                onChange={(e) => setReps(Math.max(1, Math.min(REPORT_MAX_REPS, Math.round(Number(e.target.value) || 1))))}
                className="w-24 rounded-token border border-line bg-panel px-2 py-1 tabular-nums"
              />
            </label>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-3">
          A saved run can be used only while the model is unchanged since it ran, so every number in the report reproduces it exactly.
        </p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primary} disabled={outcome?.tone === "busy"}>
          {outcome?.tone === "busy" ? "Generating…" : "Generate report"}
        </button>
        <span role="status" aria-live="polite" className="text-sm">
          {outcome?.tone === "busy" && <span className="text-fg-2">Running the model, the comparisons and their robustness checks, then printing the PDF. This can take a minute or two.</span>}
          {outcome?.tone === "error" && <span className="text-crit">{outcome.message}</span>}
          {outcome?.tone === "ok" && (
            <span className="flex flex-wrap gap-3">
              {outcome.pdf ? (
                <a href={outcome.url} className="font-semibold underline" target="_blank" rel="noreferrer">
                  Download PDF
                </a>
              ) : (
                <span className="text-crit">
                  The report is saved, but the server couldn&apos;t print the PDF ({outcome.pdfError ?? "unknown error"}). Open the printable report and use Print → Save as PDF; it&apos;s the same
                  document.
                </span>
              )}
              <a href={`/w/${slug}/reports/${outcome.id}/print`} className={outcome.pdf ? "underline" : "font-semibold underline"} target="_blank" rel="noreferrer">
                {outcome.pdf ? "Open printable report" : "Open printable report (Save as PDF)"}
              </a>
            </span>
          )}
        </span>
      </div>
      {outcome?.tone === "ok" && (outcome.omitted.length > 0 || outcome.excluded.length > 0) && (
        <ul className="list-disc pl-5 text-sm text-fg-2">
          {outcome.omitted.map((o) => (
            <li key={o.section}>
              {sectionLabel(o.section as ReportSectionId)} left out: {o.reason}
            </li>
          ))}
          {outcome.excluded.map((s) => (
            <li key={s.name}>
              “{s.name}” left out: {s.reason}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** The demo builder: a plain form that opens the demo report routes. */
export function DemoReportBuilder({ scenarios, defaultScenarios }: { scenarios: BuilderScenario[]; defaultScenarios: string[] }) {
  const [sections, setSections] = useState(() => new Set<ReportSectionId>(REPORT_SECTIONS.map((s) => s.id)));
  const [chosen, setChosen] = useState(() => new Set(defaultScenarios));
  return (
    <form method="get" action="/demo/report/print" target="_blank" className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <SectionPicker selected={sections} onChange={setSections} />
        <ScenarioPicker scenarios={scenarios} selected={chosen} onChange={setChosen} />
      </div>
      <input type="hidden" name="sections" value="cover" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" formAction="/demo/report/pdf" className={primary}>
          Generate PDF
        </button>
        <button type="submit" className={button}>
          Open printable report
        </button>
        <span className="text-sm text-fg-2">Runs 200 replications and the robustness checks on the server; the first report takes about 10–30 seconds.</span>
      </div>
    </form>
  );
}

/** Reports generated before, newest first. */
export function StoredReports({ slug, reports }: { slug: string; reports: StoredReport[] }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!reports.length) return <p className="text-sm text-fg-2">No reports yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-fg-2">
          <th className="py-1.5 font-semibold">Report</th>
          <th className="py-1.5 font-semibold">Generated</th>
          <th className="py-1.5 font-semibold">Run</th>
          <th className="py-1.5 font-semibold" />
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.id} className="border-b border-line align-top">
            <td className="py-1.5">{r.title}</td>
            <td className="py-1.5 tabular-nums text-fg-2">{new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
            <td className="py-1.5">
              {r.runId ? (
                <Link href={`/w/${slug}/runs/${r.runId}`} className="underline">
                  Saved run
                </Link>
              ) : (
                <span className="text-fg-3">deleted</span>
              )}
            </td>
            <td className="py-1.5">
              <span className="flex flex-wrap justify-end gap-3">
                {r.hasPdf && (
                  <a href={`/api/reports/${r.id}/pdf`} className="underline" target="_blank" rel="noreferrer">
                    PDF
                  </a>
                )}
                <a href={`/w/${slug}/reports/${r.id}/print`} className="underline" target="_blank" rel="noreferrer">
                  Printable
                </a>
                {r.hasPdf &&
                  (links[r.id] ? (
                    <input readOnly value={links[r.id]} onFocus={(e) => e.target.select()} className="w-56 rounded-token border border-line px-1 text-xs" aria-label="Share link" />
                  ) : (
                    <button
                      type="button"
                      className="underline"
                      onClick={async () => {
                        const res = await createReportLink(r.id);
                        if (res.status === "ok") setLinks((l) => ({ ...l, [r.id]: res.url }));
                        else setErrors((e) => ({ ...e, [r.id]: res.message }));
                      }}
                    >
                      Share link (24 h)
                    </button>
                  ))}
                {errors[r.id] && <span className="text-crit">{errors[r.id]}</span>}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
