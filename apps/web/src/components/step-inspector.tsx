"use client";

// The step inspector (PRD §4.1): every field of the selected step, each saved
// on its own through the process editor, so each change is undoable and
// re-runs the simulation.

import { useEffect, useRef } from "react";
import {
  EVIDENCE_COLUMNS,
  isOpenAssumption,
  triangularRange,
  type Distribution,
  type EvidenceStamp,
  type ProcessBundle,
  type SourceRow,
  type StepKind,
  type StepRow,
} from "@transpera-flow/db";
import { EvidencePanel } from "@/components/evidence";
import { NumberField, SelectField, TextField, type SelectOption } from "@/components/fields";
import { ProvenanceBadge } from "@/components/provenance-badge";
import {
  KIND_LABELS,
  OUTCOME_LABELS,
  STEP_KINDS,
  kindProblem,
  reworkTargets,
  setDistribution,
  setRangePoint,
  setStepKind,
  updateStep,
  type Phase,
} from "@/lib/editor/commands";
import { POSITION } from "@/lib/drafts/discard";
import type { StepChange } from "@/lib/drafts/diff";
import { describeValue, fieldLabel } from "@/lib/editor/describe";
import type { ProcessEditor } from "@/lib/editor/editor";
import { readField, type Edit, type Scalar } from "@/lib/editor/ops";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatHours } from "@/lib/format";

const DIST_OPTIONS: SelectOption[] = [
  { value: "lognormal", label: "Varies (lognormal)" },
  { value: "triangular", label: "Range (triangular)" },
  { value: "constant", label: "Always the same (constant)" },
];

/** Engine defaults for a lognormal duration's spread (packages/engine simulate.ts). */
const DEFAULT_CV: Record<Phase, number> = { work: 0.35, wait: 0.3 };

const sectionClass = "flex flex-col gap-3 border-t border-line pt-3";

export function StepInspector({
  bundle,
  step,
  editor,
  autoFocus = false,
  onFocused,
  onClose,
  onDelete,
  draft = null,
  sources = [],
  stamp,
  sourcesHref,
}: {
  bundle: ProcessBundle;
  step: StepRow;
  editor: ProcessEditor;
  /** Put focus in the first field (asked for from the step's menu). */
  autoFocus?: boolean;
  onFocused?: () => void;
  onClose: () => void;
  onDelete: () => void;
  /** In a draft (issue #9): how the draft changed this step against live, and undoing that. */
  draft?: DraftInfo | null;
  /** The workspace's sources, to cite (issue #21). */
  sources?: readonly SourceRow[];
  /** Who and when, for citing and confirming. */
  stamp?: () => EvidenceStamp;
  sourcesHref?: string;
}) {
  const id = step.id;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    onFocused?.();
  }, [autoFocus, onFocused]);
  /**
   * A saver that runs an edit; the editor saves it and reports conflicts
   * itself. With `check`, a field someone else saved while this one was
   * being typed (its stored value is no longer the one editing started from)
   * becomes a keep mine / keep theirs conflict instead of a silent overwrite.
   */
  const via =
    <T extends Scalar>(build: (b: ProcessBundle, value: T) => Edit | null, check?: { field: string; current: T }): Saver<T> =>
    async (base, next) => {
      if (check && !sameish(check.current, base) && !sameish(check.current, next)) {
        editor.raiseConflict({ table: "steps", id, field: check.field, mine: next, theirs: check.current, retry: (b) => build(b, next) });
      } else {
        editor.run((b) => build(b, next));
      }
      return { status: "saved", value: next } as SaveOutcome<T>;
    };
  const field = <T extends Scalar>(name: string) =>
    via<T>((b, v) => updateStep(b, id, { [name]: v }), { field: name, current: readField(step, name) as T });
  const working = step.kind !== "start" && step.kind !== "end";

  const kindOptions: SelectOption[] = [...STEP_KINDS, ...(step.kind === "subprocess" ? (["subprocess"] as const) : [])]
    .filter((k) => !kindProblem(bundle, id, k))
    .map((k) => ({
    value: k,
    label: KIND_LABELS[k],
  }));
  const roleOptions = bundle.roles.map((r) => ({ value: r.id, label: r.name }));
  const roleNames = new Map(bundle.roles.map((r) => [r.id, r.name]));
  const personOptions = bundle.people
    .filter((p) => p.active || p.id === step.person_id)
    .map((p) => {
      const roles = bundle.personRoles.filter((r) => r.person_id === p.id).map((r) => roleNames.get(r.role_id));
      return { value: p.id, label: roles.length ? `${p.name} (${roles.join(", ")})` : p.name };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const reworkOptions = reworkTargets(bundle, id).map((s) => ({ value: s.id, label: s.name }));

  return (
    <aside
      ref={ref}
      aria-label={`Step: ${step.name}`}
      onKeyDown={(e) => {
        // Escape outside a field closes the inspector and goes back to the step on the map.
        if (e.key !== "Escape" || (e.target as Element).closest("input, select, textarea")) return;
        onClose();
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.focus();
      }}
      className="flex max-h-[34rem] flex-col gap-3 overflow-y-auto rounded-token border border-line bg-panel p-3 shadow-token"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Step</h2>
        <button type="button" onClick={onClose} className="text-fg-2 hover:underline">
          Close
        </button>
      </div>
      {draft?.change && <DraftChanges info={draft} change={draft.change} />}
      {step.assumption && !EVIDENCE_COLUMNS.some((c) => isOpenAssumption(step, c)) && (
        <div role="note" className="flex flex-col gap-1.5 rounded-token border border-warn bg-warn-soft p-2 text-xs">
          <p>
            <strong>Estimate.</strong> This step&apos;s values haven&apos;t been confirmed. Check them, then confirm; a draft
            can&apos;t be published with estimates unless they are accepted as such.
          </p>
          <button
            type="button"
            onClick={() => editor.run((b) => updateStep(b, id, { assumption: false }))}
            className="self-start rounded-token bg-accent px-2 py-0.5 font-semibold text-accent-fg"
          >
            Confirm values
          </button>
        </div>
      )}
      <TextField label="Name" value={step.name} save={field<string | null>("name")} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Kind"
          value={step.kind}
          options={kindOptions}
          save={via<string | null>((b, v) => (v ? setStepKind(b, id, v as StepKind) : null))}
        />
        {step.kind === "end" && (
          <SelectField
            label="Outcome"
            value={step.outcome}
            options={Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label }))}
            save={via<string | null>((b, v) => (v ? updateStep(b, id, { outcome: v }) : null))}
          />
        )}
      </div>

      {working && (
        <>
          <div className={sectionClass}>
            <SelectField label="Role" value={step.role_id} options={roleOptions} noneLabel="No role" save={field("role_id")} />
            {personOptions.length > 0 && (
              <SelectField
                label="Pinned person"
                value={step.person_id}
                options={personOptions}
                noneLabel="Anyone in the role"
                save={field("person_id")}
                hint="Only this person works the step."
              />
            )}
          </div>
          <Duration phase="work" title="Hands-on time" step={step} via={via} field={field} />
          <Duration phase="wait" title="Wait after" step={step} via={via} field={field} />
          <div className={sectionClass}>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Rework rate"
                value={Number(step.rework_rate)}
                scale={100}
                unit="%"
                min={0}
                max={100}
                step={1}
                save={field("rework_rate")}
              />
              <SelectField
                label="Rework goes back to"
                value={step.rework_to_step_id}
                options={reworkOptions}
                noneLabel="This step"
                save={field("rework_to_step_id")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="SLA" value={nullableNumber(step.sla_hours)} optional unit="h" min={0} save={field("sla_hours")} />
              <NumberField
                label="Current WIP"
                value={nullableNumber(step.current_wip)}
                optional
                min={0}
                step={1}
                placeholder="Not entered"
                save={wholeNumber(field("current_wip"))}
                hint={step.current_wip !== null && <ProvenanceBadge step={step} column="current_wip" />}
              />
            </div>
            <p className="text-xs text-fg-3">
              Current WIP is what sits at this step now; entering it on any step starts the run from it instead of a
              warm-up. Rework targets and SLAs are saved but not simulated yet.
            </p>
            <TextField label="Tool" value={step.tool} optional save={field("tool")} />
          </div>
        </>
      )}

      {working && (
        <EvidencePanel step={step} editor={editor} sources={sources} stamp={stamp ?? (() => ({ at: new Date().toISOString() }))} sourcesHref={sourcesHref} />
      )}

      <div className={sectionClass}>
        <TextField label="Notes" value={step.notes} optional multiline save={field("notes")} />
        <button
          type="button"
          onClick={onDelete}
          className="self-start rounded-token border border-crit px-2.5 py-1 text-crit hover:bg-crit-soft"
        >
          Delete step
        </button>
      </div>
    </aside>
  );
}

export interface DraftInfo {
  change: StepChange | undefined;
  /** Names of steps, roles and people, live and draft, for describing values. */
  names: Map<string, string>;
  /** Put one field (or `position`) back as it is live. */
  onRevert: (field: string) => void;
  /** Put the whole step back as it is live (or remove it, if it is new). */
  onDiscard: () => void;
}

/** What the draft changed on this step, old → new, each with Revert. */
function DraftChanges({ info, change }: { info: DraftInfo; change: StepChange }) {
  const buttonClass = "rounded-token border border-line bg-panel px-1.5 py-0.5 font-semibold hover:bg-panel-2";
  if (change.kind === "added") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-token border border-dashed border-accent bg-accent-soft p-2 text-xs">
        <p>New in this draft.</p>
        <button type="button" onClick={info.onDiscard} className={buttonClass}>
          Discard step
        </button>
      </div>
    );
  }
  if (change.kind !== "changed") return null;
  // Kind and outcome revert together, so they are listed together.
  const fields = change.fields.filter((f) => f.field !== "outcome" || !change.fields.some((g) => g.field === "kind"));
  return (
    <section aria-label="Changed in this draft" className="flex flex-col gap-1.5 rounded-token border border-accent bg-accent-soft p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Changed in this draft</p>
        <button type="button" onClick={info.onDiscard} className={buttonClass}>
          Revert all
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {fields.map((f) => (
          <li key={f.field} className="flex items-center justify-between gap-2">
            <span>
              {fieldLabel(f.field)}: <s className="text-fg-3">{describeValue(f.field, f.live, info.names)}</s>{" "}
              <span aria-label="changed to">→</span> <strong>{describeValue(f.field, f.draft, info.names)}</strong>
            </span>
            <button type="button" onClick={() => info.onRevert(f.field)} className={buttonClass} aria-label={`Revert ${fieldLabel(f.field)}`}>
              Revert
            </button>
          </li>
        ))}
        {change.moved && (
          <li className="flex items-center justify-between gap-2">
            <span>Moved on the map</span>
            <button type="button" onClick={() => info.onRevert(POSITION)} className={buttonClass} aria-label="Revert position">
              Revert
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

const nullableNumber = (v: number | null) => (v === null ? null : Number(v));

/** Equal as the inspector shows values: numbers to the precision it displays, blank text as none. */
function sameish(a: Scalar, b: Scalar): boolean {
  const blank = (v: Scalar) => v === null || v === "";
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-6;
  return a === b;
}

/** Refuse fractions before they reach the saver. */
const wholeNumber =
  (save: Saver<number | null>): Saver<number | null> =>
  async (base, next) =>
    next !== null && !Number.isInteger(next) ? { status: "error", message: "Enter a whole number." } : save(base, next);

function Duration({
  phase,
  title,
  step,
  via,
  field,
}: {
  phase: Phase;
  title: string;
  step: StepRow;
  via: <T extends Scalar>(build: (b: ProcessBundle, value: T) => Edit | null, check?: { field: string; current: T }) => Saver<T>;
  field: <T extends Scalar>(name: string) => Saver<T>;
}) {
  const dist = step[`${phase}_dist`];
  const mean = Number(step[`${phase}_hours`]);
  const params = step[`${phase}_params`] ?? {};
  const range = triangularRange(params, mean);
  const point = (p: "min" | "mode" | "max") =>
    via<number | null>((b, v) => (v === null ? null : setRangePoint(b, step.id, phase, p, v)), {
      field: `${phase}_params.${p}`,
      current: range[p],
    });
  return (
    <fieldset className={sectionClass}>
      <legend className="sr-only">{title}</legend>
      <p className="text-xs font-semibold text-fg">{title}</p>
      <SelectField
        label="Distribution"
        value={dist}
        options={DIST_OPTIONS}
        save={via<string | null>((b, v) => (v ? setDistribution(b, step.id, phase, v as Distribution) : null))}
      />
      {dist === "triangular" ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Min" value={range.min} unit="h" min={0} save={point("min")} />
            <NumberField label="Most likely" value={range.mode} unit="h" min={0} save={point("mode")} />
            <NumberField label="Max" value={range.max} unit="h" min={0} save={point("max")} />
          </div>
          <p className="text-xs text-fg-3">
            Mean {formatHours(mean)}, from the range. The simulation samples between min and max.
          </p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Mean" value={mean} unit="h" min={0} save={field(`${phase}_hours`)} />
          {dist === "lognormal" && (
            <NumberField
              label="Variability (CV)"
              value={nullableNumber((params.cv as number | null | undefined) ?? null)}
              optional
              min={0}
              max={5}
              step={0.05}
              placeholder={`${DEFAULT_CV[phase]} (default)`}
              save={field(`${phase}_params.cv`)}
            />
          )}
        </div>
      )}
    </fieldset>
  );
}
