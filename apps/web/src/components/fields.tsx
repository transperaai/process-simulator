"use client";

// Inputs that save themselves one field at a time, with the "keep mine / keep
// theirs" prompt for same-field conflicts (docs/adr/0001-per-field-saves.md).
// Text-like fields save on blur or Enter (Escape reverts); toggles and
// checklists save on each change.

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { mapOutcome, type FieldValue, type Saver } from "@/lib/fields/field-controller";
import { useField, type Field } from "@/lib/fields/use-field";

const inputClass =
  "w-full rounded-token border border-line bg-panel px-2 py-1.5 tabular-nums disabled:bg-panel-2 disabled:text-fg-2";

function FieldStatus<T extends FieldValue>({ field, display }: { field: Field<T>; display: (v: T) => string }) {
  if (field.phase === "saving") {
    return (
      <p className="text-xs text-fg-3" aria-live="polite">
        Saving…
      </p>
    );
  }
  if (field.phase === "conflict") {
    return (
      <div role="alert" className="mt-1 rounded-token border border-warn bg-warn-soft p-2 text-xs">
        <p>
          Someone else changed this to <strong>{display(field.theirs as T)}</strong> while you were editing.
        </p>
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            onClick={() => void field.keepMine()}
            className="rounded-token bg-accent px-2 py-0.5 font-semibold text-accent-fg"
          >
            Keep mine ({display(field.draft)})
          </button>
          <button type="button" onClick={field.keepTheirs} className="rounded-token border border-line px-2 py-0.5">
            Keep theirs
          </button>
        </div>
      </div>
    );
  }
  if (field.phase === "error") {
    return (
      <p role="alert" className="text-xs text-crit">
        {field.message}{" "}
        <button type="button" onClick={field.revert} className="underline">
          Undo
        </button>
      </p>
    );
  }
  return null;
}

function Shell<T extends FieldValue>({
  id,
  label,
  hint,
  field,
  display,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  field: Field<T>;
  display: (v: T) => string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && field.phase === "idle" && <p className="text-xs text-fg-3">{hint}</p>}
      <FieldStatus field={field} display={display} />
    </div>
  );
}

const showText = (v: string | null) => (v === null || v === "" ? "blank" : v);

export function TextField({
  label,
  value,
  save,
  optional = false,
  multiline = false,
  type = "text",
  disabled,
  hint,
}: {
  label: string;
  value: string | null;
  save: Saver<string | null>;
  /** Blank saves as null; otherwise blank is refused. */
  optional?: boolean;
  multiline?: boolean;
  type?: "text" | "email";
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const field = useField<string | null>(value, async (base, next) => {
    const cleaned = next === null ? null : next.trim() || null;
    if (cleaned === null && !optional) return { status: "error", message: `${label} can't be blank.` };
    return save(base, cleaned);
  });
  const props = {
    id,
    disabled,
    value: field.draft ?? "",
    className: inputClass,
    onChange: (e: { target: { value: string } }) => field.edit(e.target.value),
    onBlur: () => void field.commit(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") field.revert();
      if (e.key === "Enter" && !multiline) void field.commit();
    },
  };
  return (
    <Shell id={id} label={label} hint={hint} field={field} display={showText}>
      {multiline ? <textarea rows={2} {...props} /> : <input type={type} {...props} />}
    </Shell>
  );
}

/** Dates save on change: the browser's picker commits a whole value at once. */
export function DateField({
  label,
  value,
  save,
  disabled,
}: {
  label: string;
  value: string | null;
  save: Saver<string | null>;
  disabled?: boolean;
}) {
  const id = useId();
  const field = useField<string | null>(value, (base, next) => save(base, next || null));
  return (
    <Shell id={id} label={label} field={field} display={(v) => v || "blank"}>
      <input
        id={id}
        type="date"
        disabled={disabled}
        value={field.draft ?? ""}
        className={inputClass}
        onChange={(e) => void field.commit(e.target.value || null)}
      />
    </Shell>
  );
}

export function NumberField({
  label,
  value,
  save,
  optional = false,
  scale = 1,
  unit,
  min,
  max,
  step,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  value: number | null;
  save: Saver<number | null>;
  optional?: boolean;
  /** Shown value = stored × scale, e.g. 100 to edit a fraction as a percentage. */
  scale?: number;
  unit?: string;
  /** Limits on the shown value. */
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const toText = (v: number | null) => (v === null ? "" : String(Math.round(Number(v) * scale * 1e6) / 1e6));
  const field = useField<string>(toText(value), async (base, next) => {
    const trimmed = next.trim();
    const shown = trimmed === "" ? null : Number(trimmed);
    if (shown === null && !optional) return { status: "error", message: `${label} can't be blank.` };
    if (shown !== null && !Number.isFinite(shown)) return { status: "error", message: "Enter a number." };
    if (shown !== null && ((min !== undefined && shown < min) || (max !== undefined && shown > max))) {
      return { status: "error", message: `Enter a number from ${min ?? "–"} to ${max ?? "–"}.` };
    }
    const parse = (s: number | null) => (s === null ? null : s / scale);
    const baseValue = base.trim() === "" ? null : Number(base) / scale;
    return mapOutcome(await save(baseValue, parse(shown)), toText);
  });
  const display = (v: string) => (v === "" ? "blank" : unit ? `${v} ${unit}` : v);
  return (
    <Shell id={id} label={label} hint={hint} field={field} display={display}>
      <span className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          value={field.draft}
          className={inputClass}
          onChange={(e) => field.edit(e.target.value)}
          onBlur={() => void field.commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") field.revert();
            if (e.key === "Enter") void field.commit();
          }}
        />
        {unit && <span className="shrink-0 text-fg-3">{unit}</span>}
      </span>
    </Shell>
  );
}

export function ToggleField({
  label,
  value,
  save,
  onLabel,
  offLabel,
  disabled,
}: {
  label: string;
  value: boolean;
  save: Saver<boolean>;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  const field = useField<boolean>(value, save);
  return (
    <Shell id={id} label={label} field={field} display={(v) => (v ? onLabel : offLabel)}>
      <span className="flex items-center gap-2 py-1.5">
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={field.draft}
          onChange={(e) => void field.commit(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        <span>{field.draft ? onLabel : offLabel}</span>
      </span>
    </Shell>
  );
}

export interface ChecklistOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** A set of ids, saved as a whole on each tick. */
export function ChecklistField({
  label,
  value,
  save,
  options,
  hint,
  emptyLabel = "none",
  disabled,
}: {
  label: string;
  value: readonly string[];
  save: Saver<readonly string[]>;
  options: ChecklistOption[];
  hint?: ReactNode;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const field = useField<readonly string[]>(value, save);
  const names = new Map(options.map((o) => [o.id, o.label]));
  const display = (ids: readonly string[]) =>
    ids.length ? ids.map((i) => names.get(i) ?? "a removed item").join(", ") : emptyLabel;
  const toggle = (option: string, on: boolean) => {
    const next = on ? [...field.draft, option] : field.draft.filter((v) => v !== option);
    void field.commit(next);
  };
  return (
    <fieldset className="flex flex-col gap-1" id={id}>
      <legend className="mb-1 text-xs font-medium text-fg-2">{label}</legend>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <li key={o.id}>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                disabled={disabled || field.phase === "conflict"}
                checked={field.draft.includes(o.id)}
                onChange={(e) => toggle(o.id, e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              <span>
                {o.label}
                {o.sublabel && <span className="text-fg-3"> · {o.sublabel}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {hint && field.phase === "idle" && <p className="text-xs text-fg-3">{hint}</p>}
      <FieldStatus field={field} display={display} />
    </fieldset>
  );
}
