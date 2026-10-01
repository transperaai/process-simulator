"use client";

// The process page (issue #103, A38): a read-only review of one process on a single scrolling column, no tabs and no
// drawers. First principles, Projection, Map, Insights, Issues, Solutions, then Supporting data. Editing happens in the
// Editor (A39), which "✎ Open in Editor" opens; History (A40) lists the earlier versions this page can show.

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { IssueRow, ProcessBundle, ScenarioRow, SourceRow } from "@transpera-flow/db";
import { RATING_LABELS, type AnalysisSettings, type EngineModel, type Rating } from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { withHorizon } from "@/lib/editor/modes";
import { horizonWeeks, isHorizonMonths, monthsForWeeks } from "@/lib/horizon";
import { useHiddenLevers } from "@/lib/levers/use-hidden-levers";
import { headlineCards } from "@/lib/overview/headline";
import { mrrAfter, startingMrr, summarise } from "@/lib/overview/projection";
import { resolveRun } from "@/lib/scenarios/broken";
import { leverKind, visibleLevers } from "@/lib/scenarios/lever-catalogue";
import { buildLevers, leverPatches, type LeverValues } from "@/lib/scenarios/levers";
import { processStepIds } from "@/lib/process-steps";
import { useSimulation } from "@/lib/sim/use-simulation";
import { HorizonPicker } from "./horizon-picker";
import { LeverPanel } from "./lever-panel";
import { HeadlineCards } from "./overview/headline-cards";
import { ProcessCanvas } from "./process-canvas";
import { useProcessIssues } from "./process-issues";
import { useEngineModel, type EditMode } from "./process-view";
import { ServicingBanner } from "./servicing-banner";
import { UtilisationBars } from "./utilisation-bars";
import { WaitByStep } from "./wait-by-step";

const RATING_PILL: Record<Rating, string> = {
  risk: "border-crit bg-crit-soft",
  bad: "border-serious bg-crit-soft/60",
  good: "border-warn bg-warn-soft",
  great: "border-line bg-panel-2",
};

const KIND_LABEL = { pipeline: "Pipeline", servicing: "Servicing" } as const;

/** A process inside this one, for the "Inside:" chips. */
export interface ChildProcess {
  id: string;
  name: string;
  href: string;
}

export function ProcessPage({
  bundle,
  viewingVersion = null,
  liveVersion,
  mode,
  scenarios = [],
  issues = [],
  sources = [],
  analysisRules,
  hiddenLevers,
  rating,
  registerHref,
  settingsHref,
  editHref,
  historyHref,
  inside = [],
  processPicker,
  notice,
}: {
  /** The process at the version on screen: live, or an earlier one when `viewingVersion` is set. */
  bundle: ProcessBundle;
  /** The earlier version being shown (`?version=N`), or null for live. */
  viewingVersion?: number | null;
  /** The live version's number, 0 if never published. */
  liveVersion: number;
  /** How issues are saved: to the database, in memory on the demo, or not at all for viewers. The process itself is never edited here. */
  mode: EditMode;
  scenarios?: ScenarioRow[];
  issues?: IssueRow[];
  sources?: SourceRow[];
  analysisRules?: AnalysisSettings;
  /** The lever kinds the workspace has switched off in Settings -> Levers (the demo keeps its own in the tab). */
  hiddenLevers?: string[];
  /** The process's rating: the worst of its open issues and of those of the processes inside it, as the switcher shows it. */
  rating?: Rating | null;
  registerHref?: string;
  settingsHref?: string;
  /** The Editor for this process, if the viewer may edit. */
  editHref?: string;
  /** The History page (A40, not built yet): a plain link to its route. */
  historyHref: string;
  /** Processes inside this one. */
  inside?: ChildProcess[];
  processPicker?: ReactNode;
  notice?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const horizonParam = Number(searchParams.get("horizon"));
  const [pickedMonths, setPickedMonths] = useState<number | null>(isHorizonMonths(horizonParam) ? horizonParam : null);
  const pickHorizon = (months: number) => {
    setPickedMonths(months);
    const next = new URLSearchParams(searchParams.toString());
    next.set("horizon", String(months));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const { model, error } = useEngineModel(bundle, pickedMonths === null ? null : horizonWeeks(pickedMonths));
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;

  // The levers (A58): slider values live in memory. They change the projection only; the map, insights and issues
  // keep reading the process as it is.
  const hidden = useHiddenLevers(mode === "demo", hiddenLevers);
  const leversHref = settingsHref ? `${settingsHref}/levers` : mode === "demo" ? "/demo/settings/levers" : undefined;
  const [values, setValues] = useState<LeverValues>({});
  const levers = useMemo(() => visibleLevers(model ? buildLevers(model) : [], hidden), [model, hidden]);
  const hiddenCount = hidden.filter((id) => leverKind(id)?.control === "slider").length;
  const moved = useMemo(() => leverPatches(levers, values), [levers, values]);
  const resolved = useMemo(() => (model && moved.length ? resolveRun(model, moved, {}) : null), [model, moved]);
  const projKey = resolved?.ok ? JSON.stringify(resolved.model) : null;
  const projModel = useMemo(() => (projKey ? (JSON.parse(projKey) as EngineModel) : null), [projKey]);
  const projSim = useSimulation(projModel);
  const projected = projModel ? projModel : model;
  const projectedResult = projModel ? (projSim.status === "done" ? projSim.run.result : null) : sim.status === "done" ? result : null;
  const months = projected ? (monthsForWeeks(projected.horizonWeeks) ?? Math.max(1, Math.round(projected.horizonWeeks / (52 / 12)))) : 0;
  const cards = useMemo(() => {
    if (!projected || !projectedResult) return null;
    const start = startingMrr(projected);
    const mrr = mrrAfter(projected, summarise(projected, projectedResult), start);
    return headlineCards({ model: projected, result: projectedResult, mrr, start, months, currency: bundle.workspace.settings.currency });
  }, [projected, projectedResult, months, bundle.workspace.settings.currency]);
  const levStatus = !projModel ? "Every change re-runs the simulation." : projSim.status === "running" ? "Simulating…" : projSim.status === "error" ? "Simulation failed" : "Projection updated";
  const sourceTitles = Object.fromEntries(sources.map((s) => [s.id, s.title]));

  // Back to live: the same address without ?version=.
  const backToLive = (() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("version");
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  })();

  const issuesUi = useProcessIssues({
    bundle,
    model,
    result,
    running: sim.status === "running",
    mode,
    initialIssues: issues,
    initialScenarios: scenarios,
    registerHref,
    analysisRules,
    // A badge on the map takes you down to the issues on that step.
    onShowIssues: () => document.getElementById("issues")?.scrollIntoView({ behavior: "smooth", block: "start" }),
  });

  const old = viewingVersion !== null;
  // The steps of this process and of the processes inside it, which the wait chart is about (the model may hold more).
  const stepIds = useMemo(() => processStepIds(bundle), [bundle]);
  const unpublished = liveVersion === 0;

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <div className="sticky top-0 z-20 flex items-center gap-x-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
        {/* Slots arrive from a Server Component; a keyed Fragment keeps React from asking them for keys. */}
        <Fragment key="picker">{processPicker ?? <h1 className="truncate px-1 font-display text-base font-bold">{bundle.process.name}</h1>}</Fragment>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-5">
        <header className="flex flex-wrap items-start justify-between gap-3" aria-label="Process">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
            {old ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warn bg-warn-soft px-2.5 py-0.5 text-xs font-medium">
                  Viewing version {viewingVersion} · read only
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href={backToLive}>Back to live</Link>
                </Button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-xs font-medium">
                <i aria-hidden className="size-1.5 rounded-full bg-accent" />
                {unpublished ? "Viewing the draft · not published yet" : `Viewing live · version ${liveVersion}`}
              </span>
            )}
            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs">
              {KIND_LABEL[bundle.process.kind]}
              <Help
                label="Process type"
                description="A pipeline is the main flow work moves through, from a lead to a finished client. A servicing process is a recurring job for clients you already have."
                example="Lead to live is a pipeline. A monthly report for each retainer client is servicing."
              />
            </span>
            {rating && (
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${RATING_PILL[rating]}`} data-process-rating={rating}>
                {RATING_LABELS[rating]}
                <Help
                  label="Process rating"
                  description="The worst rating among the confirmed open issues on this process and the processes inside it: Great, Good, Bad or Operational risk. Insights nobody has confirmed yet don't count."
                  example="Bad, not urgent: one confirmed issue is rated Bad and none is worse."
                />
              </span>
            )}
            {inside.length > 0 && (
              <>
                <span className="ml-1.5 text-xs text-fg-2">Inside:</span>
                {inside.map((c) => (
                  <Link key={c.id} href={c.href} className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-panel-2">
                    {c.name}
                  </Link>
                ))}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={historyHref}>History</Link>
            </Button>
            {editHref && (
              <Button asChild className="bg-edit text-edit-fg hover:bg-edit/90">
                <Link href={withHorizon(editHref, pickedMonths)}>✎ Open in Editor</Link>
              </Button>
            )}
          </div>
        </header>

        {(notice || bundle.process.kind === "servicing" || error) && (
          <div className="flex flex-col gap-2">
            <Fragment key="notice">{notice}</Fragment>
            {bundle.process.kind === "servicing" && <ServicingBanner bundle={bundle} settingsHref={settingsHref} />}
            {error && (
              <Alert className="border-crit bg-crit-soft">
                <AlertDescription className="text-fg">This process can&apos;t be simulated yet: {error}.</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <Section id="first-principles" title="First principles">
          <div className="rounded-token border border-dashed border-line p-4" data-testid="first-principles">
            <p className="text-sm font-semibold">Not started</p>
            <p className="mt-1 text-sm text-fg-2">
              Strip the process back to what is true: the job it does, hard truths, who owns each requirement, what to delete and how success is
              measured. The analysis will judge the process against it.
            </p>
          </div>
        </Section>

        <Section id="projection" title="Projection">
          {model ? (
            <div className="flex flex-col gap-3">
              <HorizonPicker weeks={model.horizonWeeks} onChange={pickHorizon} />
              <HeadlineCards cards={cards} />
              {levers.length > 0 && (
                <LeverPanel
                  levers={levers}
                  hiddenCount={hiddenCount}
                  settingsHref={leversHref}
                  values={values}
                  currency={bundle.workspace.settings.currency}
                  status={levStatus}
                  onChange={(path, v) =>
                    setValues((prev) => {
                      const next = { ...prev };
                      if (v === undefined) delete next[path];
                      else next[path] = v;
                      return next;
                    })
                  }
                  onReset={() => setValues({})}
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-2">Nothing to project until the process can be simulated.</p>
          )}
        </Section>

        <Section
          id="map"
          title="Map"
          hint="Coloured by rating. Red badges are confirmed issues. Click a step for detail."
          help={{
            label: "Map colours",
            description: "A step is coloured by the worst rating among its confirmed open issues. Red badges count confirmed issues. Things the analysis only noticed show under Insights until someone confirms them.",
            example: "A step with one Bad issue is orange with a badge of 1; a step with only an unconfirmed insight stays plain.",
          }}
        >
          <ProcessCanvas
            bundle={bundle}
            result={result}
            savedLabel="Saved"
            openIssues={issuesUi.openIssues}
            rating={issuesUi.rating}
            stepExtras={issuesUi.stepExtras}
            highlight={issuesUi.highlight}
            sourceTitles={sourceTitles}
          />
        </Section>

        <Section
          id="insights"
          title="Insights"
          hint="What the analysis found in the latest run. Nothing reaches the map until someone confirms it."
          help={{
            label: "Insights",
            description: "Things the rules noticed in the simulation. They are suggestions: they stay off the map until someone confirms one as an issue.",
            example: "Proposals wait 38 h before review. Confirm it and it becomes an issue with a red badge on that step.",
          }}
        >
          {issuesUi.insightsList}
        </Section>

        <Section
          id="issues"
          title="Issues"
          hint="Open issues linked to this process or its steps."
          help={{
            label: "Issues",
            description: "Problems the team has agreed to own, written by hand or confirmed from an insight. Each has a rating, an owner and a status.",
            example: "Only one copywriter can do reviews: rated Operational risk, owned by Maya, status Open.",
          }}
        >
          {issuesUi.issuesList}
          {registerHref && (
            <Link href={registerHref} className="mt-2 block text-xs text-fg-2 hover:underline">
              Open the full register →
            </Link>
          )}
        </Section>

        <Section
          id="solutions"
          title="Solutions"
          hint="Bundles of steps tested against an issue. They never change the live map."
        >
          <div className="rounded-token border border-dashed border-line p-4 text-sm text-fg-2" data-testid="solutions-placeholder">
            No solutions yet. They will appear here once they can be built from an issue.
          </div>
        </Section>

        <Section id="supporting-data" title="Supporting data" hint="From the latest run.">
          {model ? (
            <div className="grid gap-3 md:grid-cols-2">
              <WaitByStep model={model} result={result} stepIds={stepIds} />
              <UtilisationBars model={model} result={result} />
            </div>
          ) : (
            <p className="text-sm text-fg-2">Nothing to show until the process can be simulated.</p>
          )}
        </Section>
      </div>
      {issuesUi.badges}
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  help,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  help?: { label: string; description: string; example: string };
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex min-w-0 scroll-mt-16 flex-col gap-3">
      <div>
        <div className="flex items-center">
          <h2 id={`${id}-heading`} className="font-display text-lg font-bold">
            {title}
          </h2>
          {help && <Help {...help} />}
        </div>
        {hint && <p className="text-sm text-fg-2">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
