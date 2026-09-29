"use client";

// The step inspector (PRD §4.1): every field of the selected step, each saved
// on its own through the process editor, so each change is undoable and
// re-runs the simulation.

import { triangularRange, type Distribution, type ProcessBundle, type StepKind, type StepRow } from "@transpera-flow/db";
import { NumberField, SelectField, TextField, type SelectOption } from "@/components/fields";
import {
  KIND_LABELS,
  OUTCOME_LABELS,
  STEP_KINDS,
  setDistribution,
  setRangePoint,
  setStepKind,
  updateStep,
  type Phase,
} from "@/lib/editor/commands";
import type { ProcessEditor } from "@/lib/editor/editor";
import type { Edit, Scalar } from "@/lib/editor/ops";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatHours } from "@/lib/format";

/** Labels for step and edge fields, also used to describe conflicts. */
export const FIELD_LABELS: Record<string, string> = {
  name: "name",
  kind: "kind",
  outcome: "outcome",
  role_id: "role",
  person_id: "pinned person",
  work_hours: "hands-on time",
  work_dist: "hands-on distribution",
  "work_params.cv": "hands-on variability",
  "work_params.min": "hands-on minimum",
  "work_params.mode": "hands-on most likely",
  "work_params.max": "hands-on maximum",
  wait_hours: "wait time",
  wait_dist: "wait distribution",
  "wait_params.cv": "wait variability",
  "wait_params.min": "wait minimum",
  "wait_params.mode": "wait most likely",
  "wait_params.max": "wait maximum",
  rework_rate: "rework rate",
  rework_to_step_id: "rework target",
  tool: "tool",
  notes: "notes",
  sla_hours: "SLA",
  current_wip: "current WIP",
  x: "position",
  y: "position",
  probability: "branch probability",
  condition_tag: "condition tag",
  label: "label",
  from_step_id: "start of the connection",
  to_step_id: "end of the connection",
};

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
  onClose,
  onDelete,
}: {
  bundle: ProcessBundle;
  step: StepRow;
  editor: ProcessEditor;
  onClose: () => void;
  onDelete: () => void;
}) {
  const id = step.id;
  /** A saver that runs an edit; the editor saves it and reports conflicts itself. */
  const via =
    <T extends Scalar>(build: (b: ProcessBundle, value: T) => Edit | null): Saver<T> =>
    async (_base, next) => {
      editor.run((b) => build(b, next));
      return { status: "saved", value: next } as SaveOutcome<T>;
    };
  const field = <T extends Scalar>(name: string) => via<T>((b, v) => updateStep(b, id, { [name]: v }));
  const working = step.kind !== "start" && step.kind !== "end";

  const kindOptions: SelectOption[] = [...STEP_KINDS, ...(step.kind === "subprocess" ? (["subprocess"] as const) : [])].map((k) => ({
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
  const reworkOptions = bundle.steps
    .filter((s) => s.id !== id && s.kind !== "start" && s.kind !== "end")
    .map((s) => ({ value: s.id, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <aside
      aria-label={`Step: ${step.name}`}
      className="flex max-h-[34rem] flex-col gap-3 overflow-y-auto rounded-token border border-line bg-panel p-3 shadow-token"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Step</h2>
        <button type="button" onClick={onClose} className="text-fg-2 hover:underline">
          Close
        </button>
      </div>
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

const nullableNumber = (v: number | null) => (v === null ? null : Number(v));

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
  via: <T extends Scalar>(build: (b: ProcessBundle, value: T) => Edit | null) => Saver<T>;
  field: <T extends Scalar>(name: string) => Saver<T>;
}) {
  const dist = step[`${phase}_dist`];
  const mean = Number(step[`${phase}_hours`]);
  const params = step[`${phase}_params`] ?? {};
  const range = triangularRange(params, mean);
  const point = (p: "min" | "mode" | "max") =>
    via<number | null>((b, v) => (v === null ? null : setRangePoint(b, step.id, phase, p, v)));
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
