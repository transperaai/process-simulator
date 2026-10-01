"use client";

// The Edit dialog for one analysis rule (issue #109; prototype: Settings -> Analysis rules, "Edit"): the plain
// description and example, "Use this rule", the cut-offs with the default beside each and a live preview of the four
// bands, how the cost per month is worked out, the overrides, and "Reset to default". Every valid change is applied
// at once, which re-rates the latest run behind the dialog.

import { useState } from "react";
import {
  ANALYSIS_RULE_SPECS,
  inputsProblem,
  resolveAnalysisRule,
  type AnalysisOverride,
  type AnalysisRuleId,
  type AnalysisSettings,
  type OverrideKind,
} from "@transpera-flow/engine";
import { Help } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { KIND_NAMES, OLD_LOGIC, RULES_UI, SETTING_HELP, bandsOf, fromDisplay, shown, toDisplay } from "@/lib/rules/catalogue";
import { addOverride, removeOverride, resetRule, setRuleEnabled, setRuleInputs } from "@/lib/rules/edit";
import { BandChips, subjectLabel, type Subjects } from "./controls";

const parseAll = (texts: string[]): number[] | null => {
  const n = texts.map((t) => (t.trim() === "" ? NaN : Number(t)));
  return n.every(Number.isFinite) ? n : null;
};

/** The cut-off boxes with the default beside each; reports the numbers (display units) when they are all valid. */
function CutoffBoxes({
  rule,
  texts,
  onChange,
  disabled,
  withDefaults,
  idPrefix,
  errorId,
}: {
  rule: AnalysisRuleId;
  texts: string[];
  onChange: (texts: string[]) => void;
  disabled: boolean;
  withDefaults: boolean;
  idPrefix: string;
  /** The id of the message that says what is wrong with the boxes, when something is. */
  errorId?: string;
}) {
  const ui = RULES_UI[rule];
  const defaults = toDisplay(rule, ANALYSIS_RULE_SPECS[rule].defaults);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
      {ui.inputs.map((input, i) => (
        <div key={input.label} className="contents">
          <label htmlFor={`${idPrefix}-${i}`} className="text-sm">
            {input.label}
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-${i}`}
              type="number"
              inputMode="decimal"
              step={input.step}
              min={0}
              value={texts[i] ?? ""}
              disabled={disabled}
              aria-invalid={errorId ? true : undefined}
              aria-describedby={errorId}
              className="w-20 text-right tabular-nums"
              onChange={(e) => onChange(texts.map((t, k) => (k === i ? e.target.value : t)))}
            />
            <span className="w-14 text-xs text-muted-foreground">{input.unit}</span>
          </div>
          {withDefaults && (
            <span className="col-span-2 -mt-1 text-xs text-muted-foreground sm:col-span-1 sm:mt-0">
              default {shown(defaults[i]!)}
              {input.unit && input.unit !== "%" ? ` ${input.unit}` : input.unit}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function RuleDialog({
  rule,
  open,
  onOpenChange,
  settings,
  update,
  canEdit,
  subjects,
  findings,
}: {
  rule: AnalysisRuleId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AnalysisSettings;
  update: (next: AnalysisSettings) => void;
  canEdit: boolean;
  subjects: Subjects;
  /** Findings this rule has on the latest run, when it is on the rating model. */
  findings: number | null;
}) {
  const ui = RULES_UI[rule];
  const spec = ANALYSIS_RULE_SPECS[rule];
  const current = resolveAnalysisRule(settings, rule);
  const [texts, setTexts] = useState<string[]>(() => toDisplay(rule, current.inputs).map(String));
  const parsed = parseAll(texts);
  const stored = parsed ? fromDisplay(rule, parsed) : null;
  const problem = stored ? inputsProblem(rule, stored) : ui.inputs.length ? "Enter a number in every box." : null;
  // The preview follows what is typed while it is valid, and the saved cut-offs otherwise.
  const previewInputs = stored && !problem ? stored : current.inputs;

  const edit = (next: string[]) => {
    setTexts(next);
    const n = parseAll(next);
    if (!n) return;
    const inputs = fromDisplay(rule, n);
    if (!inputsProblem(rule, inputs)) update(setRuleInputs(settings, rule, inputs));
  };
  const reset = () => {
    update(resetRule(settings, rule));
    setTexts(toDisplay(rule, spec.defaults).map(String));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            {ui.name}
            <Help label={ui.name} {...ui.help} />
          </DialogTitle>
          <DialogDescription>
            {ui.help.description} <span className="text-foreground">Example:</span> {ui.help.example}
          </DialogDescription>
        </DialogHeader>

        {spec.engine === null && (
          <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {OLD_LOGIC.has(rule)
              ? "This check uses its old cut-offs for now. Switching it off works now; the cut-offs you set here are saved and apply once it moves to the new ratings."
              : "This check isn't rated by the simulation yet. What you set here is saved with the workspace and applies as soon as it is."}
          </p>
        )}

        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={current.enabled} disabled={!canEdit} onCheckedChange={(on) => update(setRuleEnabled(settings, rule, on))} />
          Use this rule
        </label>

        {ui.inputs.length > 0 && (
          <section className="flex flex-col gap-2" aria-label="Cut-offs">
            <h3 className="flex items-center text-sm font-semibold">
              Cut-offs
              <Help {...SETTING_HELP.cutoffs} />
            </h3>
            <CutoffBoxes rule={rule} texts={texts} onChange={edit} disabled={!canEdit || !current.enabled} withDefaults idPrefix={`cut-${rule}`} errorId={problem ? `cut-${rule}-error` : undefined} />
            {problem && (
              <p id={`cut-${rule}-error`} role="alert" className="text-xs text-destructive">
                {problem} Nothing is saved until this is fixed.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2" aria-label="How it will read">
          <h3 className="text-sm font-semibold">How it will read</h3>
          <BandChips bands={bandsOf(rule, previewInputs)} dimmed={!current.enabled} />
          <p className="text-xs text-muted-foreground">
            <b className="font-medium text-foreground">Rates:</b> {ui.rates}. <b className="font-medium text-foreground">Cost per month:</b> {ui.cost}.
            {findings !== null && (
              <>
                {" "}
                <b className="font-medium text-foreground">Latest run:</b> {findings === 0 ? "nothing flagged" : `${findings} flagged`} with these cut-offs.
              </>
            )}
          </p>
        </section>

        {ui.overrideKinds.length > 0 && (
          <OverridesSection rule={rule} settings={settings} update={update} canEdit={canEdit} subjects={subjects} texts={texts} problem={problem} />
        )}

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="outline" size="sm" onClick={reset} disabled={!canEdit || !current.changed}>
            Reset to default
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function summary(rule: AnalysisRuleId, o: AnalysisOverride): string {
  const parts: string[] = [];
  if (o.enabled === false) parts.push("rule off");
  if (o.inputs) parts.push(bandsOf(rule, o.inputs).filter(Boolean).join(" · "));
  if (o.expectedWaitHours !== undefined) parts.push(`expected wait ${shown(o.expectedWaitHours)} h`);
  return parts.join(" · ");
}

function OverridesSection({
  rule,
  settings,
  update,
  canEdit,
  subjects,
  texts,
  problem,
}: {
  rule: AnalysisRuleId;
  settings: AnalysisSettings;
  update: (next: AnalysisSettings) => void;
  canEdit: boolean;
  subjects: Subjects;
  /** The dialog's cut-off boxes, which a new override starts from. */
  texts: string[];
  problem: string | null;
}) {
  const ui = RULES_UI[rule];
  const overrides = resolveAnalysisRule(settings, rule).overrides;
  const kinds = ui.overrideKinds.filter((k) => subjects[k].length > 0);
  const [kind, setKind] = useState<OverrideKind | "">("");
  const [subject, setSubject] = useState("");
  const [off, setOff] = useState(false);
  const [wait, setWait] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activeKind = kind || kinds[0] || "";
  const options = activeKind ? subjects[activeKind] : [];

  const add = () => {
    if (!activeKind) return;
    const id = subject || options[0]?.id;
    if (!id) return;
    const label = options.find((o) => o.id === id)?.name;
    const n = parseAll(texts);
    const override: AnalysisOverride = { kind: activeKind, id, ...(label ? { label } : {}), ...(why.trim() ? { why: why.trim() } : {}) };
    if (off) override.enabled = false;
    else if (ui.inputs.length) {
      if (!n || problem) return setError("Fix the cut-offs above first: a new override starts from them.");
      override.inputs = fromDisplay(rule, n);
    }
    if (ui.hasExpectedWait && wait.trim() !== "") {
      const h = Number(wait);
      if (!Number.isFinite(h) || h < 0.25 || h > 2000) return setError("An expected wait is between 0.25 and 2000 hours.");
      override.expectedWaitHours = h;
    }
    setError(null);
    update(addOverride(settings, rule, override));
    setWhy("");
    setWait("");
    setOff(false);
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Overrides">
      <h3 className="flex items-center text-sm font-semibold">
        Overrides
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{overrides.length ? `${overrides.length} set` : "none"}</span>
        <Help {...SETTING_HELP.overrides} />
      </h3>
      {overrides.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {overrides.map((o) => (
            <li key={`${o.kind}:${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <b className="font-medium">{subjectLabel(subjects, o)}</b>
                <span className="text-muted-foreground"> ({KIND_NAMES[o.kind].one})</span>
                <div className="text-xs text-muted-foreground">
                  {summary(rule, o)}
                  {o.why ? ` · ${o.why}` : ""}
                </div>
              </div>
              {canEdit && (
                <Button variant="ghost" size="xs" onClick={() => update(removeOverride(settings, rule, o.kind, o.id))} aria-label={`Remove the override for ${subjectLabel(subjects, o)}`}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && kinds.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Applies to
              <NativeSelect
                value={activeKind}
                onChange={(e) => {
                  setKind(e.target.value as OverrideKind);
                  setSubject("");
                }}
                aria-label="What the override applies to"
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_NAMES[k].one[0]!.toUpperCase() + KIND_NAMES[k].one.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Which one
              <NativeSelect value={subject || options[0]?.id || ""} onChange={(e) => setSubject(e.target.value)} aria-label="Which one the override applies to">
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {ui.hasExpectedWait && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center">
                Expected wait (hours)
                <Help {...SETTING_HELP.expectedWait} />
              </span>
              <Input type="number" min={0.25} step={0.25} placeholder="the normal wait" value={wait} onChange={(e) => setWait(e.target.value)} className="w-32" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Why (optional)
            <Input value={why} maxLength={200} placeholder="Only strategist; keep her lower" onChange={(e) => setWhy(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={off} onCheckedChange={setOff} />
            Don&apos;t use this rule for it
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div>
            <Button variant="outline" size="sm" onClick={add}>
              {off || !ui.inputs.length ? "+ Add override" : "+ Add override with these cut-offs"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
