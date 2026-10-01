"use client";

// Settings -> Analysis rules (issue #109; docs/analysis-rules.md "Editing the rules"; prototype: Settings -> Analysis
// rules). The two escalator switches, the money settings and defaults, and one row per rule with its on/off switch,
// the four bands, its overrides and Edit. Everything is editable and saves as you go (per workspace). The latest run
// is simulated once; each change re-rates it on the spot, with no new simulation, and the page shows what the rules
// now flag.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelError, toEngineModel, type AnalysisRules, type ProcessBundle } from "@transpera-flow/db";
import {
  ANALYSIS_RULE_IDS,
  ANALYSIS_RULE_SPECS,
  MONEY_LIMITS,
  resolveAnalysisRule,
  resolveMoney,
  type AnalysisRuleId,
  type AnalysisSettings,
  type EngineModel,
  type RatingRuleId,
} from "@transpera-flow/engine";
import { RATING_LABELS, RATINGS } from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { Page } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { OLD_LOGIC, RULES_UI, SETTING_HELP, bandsOf, shown } from "@/lib/rules/catalogue";
import { getDemoAnalysisRules, setDemoAnalysisRules } from "@/lib/rules/demo-store";
import { rerate, resetAll, setEscalator, setMoney, setRuleEnabled, tally } from "@/lib/rules/edit";
import { useSimulation } from "@/lib/sim/use-simulation";
import { cn } from "@/lib/utils";
import { saveRules } from "@/app/w/[slug]/settings/rules/actions";
import { RATING_DOT, subjectsOf, type SubjectOption } from "./controls";
import { RuleDialog } from "./rule-dialog";

export type RulesMode = "live" | "readonly" | "demo";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string } | { kind: "conflict"; theirs: AnalysisRules };

const SAVE_DELAY_MS = 500;

export function AnalysisRulesSettings({
  mode,
  workspaceId,
  initial,
  bundle,
  processes,
}: {
  mode: RulesMode;
  workspaceId: string | null;
  initial: AnalysisRules;
  /** The live process: its model is simulated for the preview and names what an override can apply to. */
  bundle: ProcessBundle | null;
  processes: SubjectOption[];
}) {
  const canEdit = mode !== "readonly";
  const [settings, setSettings] = useState<AnalysisSettings>(() => (mode === "demo" ? getDemoAnalysisRules() : initial.settings));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [editing, setEditing] = useState<AnalysisRuleId | null>(null);
  const version = useRef(initial.version);
  const latest = useRef(settings);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  // The latest run: simulated once, re-rated on every change.
  const model = useMemo<EngineModel | null>(() => {
    if (!bundle) return null;
    try {
      return toEngineModel(bundle);
    } catch (err) {
      if (err instanceof ModelError) return null;
      throw err;
    }
  }, [bundle]);
  const sim = useSimulation(model);
  const result = sim.run?.result ?? null;
  const issues = useMemo(() => (model && result ? rerate(model, result, settings, bundle?.process.id) : null), [model, result, settings, bundle]);
  const counts = useMemo(() => (issues ? tally(issues) : null), [issues]);
  const subjects = useMemo(() => subjectsOf(model, processes), [model, processes]);
  const currency = bundle?.workspace.settings.currency ?? "AUD";
  const hoursPerDay = (model?.hoursPerWeek ?? 40) / 5;

  // Saves what is pending, one request at a time; edits made while one is running go in the next.
  const flush = useCallback(async () => {
    if (inFlight.current || !workspaceId) return;
    inFlight.current = true;
    try {
      while (dirty.current) {
        dirty.current = false;
        setState({ kind: "saving" });
        try {
          const out = await saveRules(workspaceId, latest.current, version.current);
          if (out.status === "saved") {
            version.current = out.rules.version;
            setState(dirty.current ? { kind: "saving" } : { kind: "saved" });
          } else if (out.status === "conflict") {
            dirty.current = false;
            setState({ kind: "conflict", theirs: out.rules });
          } else setState({ kind: "error", message: out.message });
        } catch {
          setState({ kind: "error", message: "Couldn't save. Check your connection and try again." });
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [workspaceId]);

  const update = useCallback(
    (next: AnalysisSettings) => {
      latest.current = next;
      setSettings(next);
      if (mode === "demo") return setDemoAnalysisRules(next);
      if (mode !== "live") return;
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [mode, flush],
  );

  useEffect(
    () => () => {
      // Leaving the page: save what is pending rather than drop it.
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    },
    [flush],
  );
  const money = resolveMoney(settings);
  const rows = ANALYSIS_RULE_IDS.map((id) => ({ id, ui: RULES_UI[id], r: resolveAnalysisRule(settings, id) }));
  const anyChanged = rows.some((x) => x.r.changed) || Boolean(settings.escalators) || Boolean(settings.money);

  return (
    <Page
      title="Analysis rules"
      eyebrow="Settings"
      description="Fixed checks that run on every simulation. Each turns a number into a rating. Everything here is editable: switch rules on or off, change the cut-offs, or override them for one role, person or step."
      actions={
        <>
          <SaveStatus state={state} mode={mode} />
          <Button variant="outline" size="sm" disabled={!canEdit || !anyChanged} onClick={() => update(resetAll())}>
            Reset all to defaults
          </Button>
        </>
      }
    >
      {mode === "readonly" && (
        <p role="note" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Only owners and editors can change the rules. You can see them here.
        </p>
      )}
      {mode === "demo" && (
        <p role="note" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Demo mode: your changes re-rate the demo&apos;s Issues straight away and stay in this tab, gone when you reload.
        </p>
      )}
      {state.kind === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-sm">
          <span>Someone else changed these rules while you were editing.</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                dirty.current = false;
                version.current = state.theirs.version;
                latest.current = state.theirs.settings;
                setSettings(state.theirs.settings);
                setState({ kind: "idle" });
              }}
            >
              Use theirs
            </Button>
            <Button
              size="sm"
              onClick={() => {
                version.current = state.theirs.version;
                dirty.current = true;
                void flush();
              }}
            >
              Keep mine
            </Button>
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-heading text-base font-medium">How a rating is set</h2>
            <p className="text-sm text-muted-foreground">
              We test each process 30 times. The <b className="font-medium text-foreground">average</b> sets the level. Then:
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <EscalatorRow
              label={
                <>
                  Count <b>busy months</b> too, not just the average
                </>
              }
              help={SETTING_HELP.badMonth}
              checked={!settings.escalators || settings.escalators.badMonth !== false}
              disabled={!canEdit}
              onChange={(on) => update(setEscalator(settings, "badMonth", on))}
            />
            <EscalatorRow
              label={
                <>
                  Treat problems at the <b>slowest step</b> as more serious
                </>
              }
              help={SETTING_HELP.bottleneck}
              checked={!settings.escalators || settings.escalators.bottleneck !== false}
              disabled={!canEdit}
              onChange={(on) => update(setEscalator(settings, "bottleneck", on))}
            />
            <p className="text-xs text-muted-foreground">Each one moves a problem up one level, never past Operational risk.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-base font-medium">Money and defaults</h2>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm">
              <dt>Lost client or deal</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                counts as at most
                <MoneyBox
                  label="Most months of fees a loss counts as"
                  value={settings.money?.capMonths}
                  fallback={money.capMonths}
                  min={MONEY_LIMITS.capMonths.min}
                  max={MONEY_LIMITS.capMonths.max}
                  disabled={!canEdit}
                  onChange={(v) => update(setMoney(settings, { capMonths: v }))}
                />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  months of fees
                  <Help {...SETTING_HELP.cap} />
                </span>
              </dd>
              <dt>Someone away</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                test
                <MoneyBox
                  label="Weeks someone is away in the test"
                  value={settings.money?.absenceWeeks}
                  fallback={money.absenceWeeks}
                  min={MONEY_LIMITS.absenceWeeks.min}
                  max={MONEY_LIMITS.absenceWeeks.max}
                  disabled={!canEdit}
                  onChange={(v) => update(setMoney(settings, { absenceWeeks: v }))}
                />
                <Help {...SETTING_HELP.absenceWeeks} />
                weeks off,
                <MoneyBox
                  label="Times a year someone is away"
                  value={settings.money?.absencesPerYear}
                  fallback={money.absencesPerYear}
                  min={MONEY_LIMITS.absencesPerYear.min}
                  max={MONEY_LIMITS.absencesPerYear.max}
                  disabled={!canEdit}
                  onChange={(v) => update(setMoney(settings, { absencesPerYear: v }))}
                />
                <Help {...SETTING_HELP.absenceTimes} />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  times a year
                  <Help {...SETTING_HELP.absence} />
                </span>
              </dd>
              <dt>Normal wait</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                sales steps
                <MoneyBox
                  label="Normal wait for sales steps, in hours"
                  value={settings.money?.waitHours?.pipeline}
                  fallback={hoursPerDay}
                  min={MONEY_LIMITS.waitHours.min}
                  max={MONEY_LIMITS.waitHours.max}
                  disabled={!canEdit}
                  onChange={(v) => update(setMoney(settings, { waitHours: { pipeline: v } }))}
                />
                <Help {...SETTING_HELP.waitSales} />
                h · client work
                <MoneyBox
                  label="Normal wait for client work, in hours"
                  value={settings.money?.waitHours?.servicing}
                  fallback={hoursPerDay * 2}
                  min={MONEY_LIMITS.waitHours.min}
                  max={MONEY_LIMITS.waitHours.max}
                  disabled={!canEdit}
                  onChange={(v) => update(setMoney(settings, { waitHours: { servicing: v } }))}
                />
                <Help {...SETTING_HELP.waitClient} />
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  h
                  <Help {...SETTING_HELP.wait} />
                </span>
              </dd>
              <dt>Currency</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {currency} <span className="text-xs text-muted-foreground">(from Company settings)</span>
                <Help {...SETTING_HELP.currency} />
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-heading text-base font-medium">The latest run, rated now</h2>
          <p className="text-sm text-muted-foreground">
            Change a rule and this re-rates the run below on the spot. It doesn&apos;t simulate again.
          </p>
        </CardHeader>
        <CardContent>
          <LatestRun counts={counts} running={sim.status === "running"} hasModel={model !== null} processName={bundle?.process.name ?? null} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-label="Rules">
        <h2 className="font-heading text-base font-medium">The rules</h2>
        <div className="hidden md:block">
          <div role="table" aria-label="Analysis rules" className="overflow-hidden rounded-lg border border-border text-sm">
            <div role="row" className="grid grid-cols-[3rem_minmax(11rem,1.4fr)_repeat(4,minmax(0,1fr))_5.5rem_4rem] items-center gap-x-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span role="columnheader">On</span>
              <span role="columnheader">Rule</span>
              {RATINGS.map((r) => (
                <span key={r} role="columnheader" className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", RATING_DOT[r])} aria-hidden />
                  {RATING_LABELS[r]}
                </span>
              ))}
              <span role="columnheader">Overrides</span>
              <span role="columnheader" className="sr-only">
                Edit
              </span>
            </div>
            {rows.map(({ id, ui, r }) => (
              <div
                key={id}
                role="row"
                data-rule={id}
                className={cn("grid grid-cols-[3rem_minmax(11rem,1.4fr)_repeat(4,minmax(0,1fr))_5.5rem_4rem] items-center gap-x-3 border-b border-border px-3 py-2.5 last:border-0", !r.enabled && "opacity-60")}
              >
                <span role="cell">
                  <Switch checked={r.enabled} disabled={!canEdit} onCheckedChange={(on) => update(setRuleEnabled(settings, id, on))} aria-label={`Use ${ui.name}`} />
                </span>
                <span role="cell" className="min-w-0">
                  <RuleName id={id} counts={counts} />
                </span>
                {bandsOf(id, r.inputs).map((b, i) => (
                  <span key={i} role="cell" className="min-w-0 text-xs">
                    {b || <span className="text-muted-foreground">-</span>}
                  </span>
                ))}
                <span role="cell" className="text-xs text-muted-foreground">
                  {r.overrides.length ? `${r.overrides.length} set` : "none"}
                </span>
                <span role="cell">
                  <Button variant="outline" size="xs" onClick={() => setEditing(id)} aria-label={`${canEdit ? "Edit" : "View"} ${ui.name}`}>
                    {canEdit ? "Edit" : "View"}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>

        <ul className="flex flex-col gap-2 md:hidden">
          {rows.map(({ id, ui, r }) => (
            <li key={id} data-rule={id} className={cn("flex flex-col gap-2 rounded-lg border border-border p-3", !r.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <RuleName id={id} counts={counts} />
                <Switch checked={r.enabled} disabled={!canEdit} onCheckedChange={(on) => update(setRuleEnabled(settings, id, on))} aria-label={`Use ${ui.name}`} />
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {bandsOf(id, r.inputs).map((b, i) => (
                  <div key={i} className="contents">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={cn("size-2 rounded-full", RATING_DOT[RATINGS[i]!])} aria-hidden />
                      {RATING_LABELS[RATINGS[i]!]}
                    </dt>
                    <dd>{b || <span className="text-muted-foreground">-</span>}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Overrides: {r.overrides.length ? `${r.overrides.length} set` : "none"}</span>
                <Button variant="outline" size="xs" onClick={() => setEditing(id)} aria-label={`${canEdit ? "Edit" : "View"} ${ui.name}`}>
                  {canEdit ? "Edit" : "View"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <RuleDialog
          key={editing}
          rule={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          settings={settings}
          update={update}
          canEdit={canEdit}
          subjects={subjects}
          findings={counts && editingEngine(editing) ? (counts.byRule[editingEngine(editing)!] ?? 0) : null}
        />
      )}
    </Page>
  );
}

const editingEngine = (id: AnalysisRuleId): RatingRuleId | null => ANALYSIS_RULE_SPECS[id].engine;

function RuleName({ id, counts }: { id: AnalysisRuleId; counts: ReturnType<typeof tally> | null }) {
  const ui = RULES_UI[id];
  const engine = editingEngine(id);
  const n = engine && counts ? (counts.byRule[engine] ?? 0) : null;
  return (
    <div className="min-w-0">
      <span className="flex flex-wrap items-center">
        <b className="font-medium">{ui.name}</b>
        <Help label={ui.name} {...ui.help} />
        {n !== null && n > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">{n} flagged</span>}
        {engine === null && (
          <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">{OLD_LOGIC.has(id) ? "old cut-offs for now" : "not rated yet"}</span>
        )}
      </span>
      <div className="text-xs text-muted-foreground">{ui.rates}</div>
    </div>
  );
}

function EscalatorRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: React.ReactNode;
  help: { label: string; description: string; example: string };
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {/* The switch is named by the visible text, so the two never differ. */}
      <label className="flex items-center gap-2">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <span>{label}</span>
      </label>
      <Help label={help.label} description={help.description} example={help.example} />
    </div>
  );
}

/** A number box that shows the default as its placeholder; empty means the default. Applies as soon as the number is allowed. */
function MoneyBox({
  label,
  value,
  fallback,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [seen, setSeen] = useState(value);
  // Follows a change from outside (Reset all to defaults), but not the number being typed.
  if (value !== seen) {
    setSeen(value);
    if ((text.trim() === "" ? undefined : Number(text)) !== value) setText(value === undefined ? "" : String(value));
  }
  const n = Number(text);
  const invalid = text.trim() !== "" && (!Number.isFinite(n) || n < min || n > max);
  return (
    <Input
      type="number"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? `Between ${min} and ${max}` : undefined}
      min={min}
      max={max}
      step="any"
      placeholder={shown(fallback)}
      value={text}
      disabled={disabled}
      className="h-7 w-16 px-1.5 text-right tabular-nums"
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim() === "" ? undefined : Number(e.target.value);
        if (v === undefined || (Number.isFinite(v) && v >= min && v <= max)) onChange(v);
      }}
    />
  );
}

function LatestRun({ counts, running, hasModel, processName }: { counts: ReturnType<typeof tally> | null; running: boolean; hasModel: boolean; processName: string | null }) {
  if (!hasModel) return <p className="text-sm text-muted-foreground">There is no published process to rate yet. Publish one and the rules rate its latest run here.</p>;
  if (!counts) return <p className="text-sm text-muted-foreground">{running ? "Simulating the latest run…" : "No run yet."}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2" aria-label={`Findings on ${processName ?? "the latest run"}`}>
        {(["risk", "bad", "good"] as const).map((r) => (
          <li key={r} data-rating={r} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            <span className={cn("size-2 rounded-full", RATING_DOT[r])} aria-hidden />
            <b className="tabular-nums">{counts.byRating[r]}</b> {RATING_LABELS[r]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {counts.total === 0 ? "Nothing is flagged on" : `${counts.total} ${counts.total === 1 ? "finding" : "findings"} on`} {processName ?? "the latest run"}, from 30 simulated runs.
        {running && " Simulating again…"}
      </p>
    </div>
  );
}

function SaveStatus({ state, mode }: { state: SaveState; mode: RulesMode }) {
  if (mode !== "live") return null;
  const text =
    state.kind === "saving" ? "Saving…" : state.kind === "saved" ? "Saved" : state.kind === "error" ? state.message : state.kind === "conflict" ? "Not saved" : "";
  if (!text) return null;
  return (
    <span role="status" className={cn("text-xs", state.kind === "error" || state.kind === "conflict" ? "text-destructive" : "text-muted-foreground")}>
      {text}
    </span>
  );
}
