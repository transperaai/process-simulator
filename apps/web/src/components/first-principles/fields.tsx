"use client";

// Small building blocks for the first-principles flow (issue #119). Every control sits in a `Field`, which draws its
// label and its (i); the test in test/settings-help.test.ts reads this folder and fails on a control without one.

import { useId, useState, type ReactNode } from "react";
import { Help } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface FpHelp {
  description: string;
  example: string;
}

/** A label with its (i) and, below it, the control the caller passes (given the id the label points at). */
export function Field({
  label,
  help,
  missing = false,
  className,
  children,
}: {
  label: string;
  help: FpHelp;
  /** Drawn with a warning edge, for an answer the checks want filled in. */
  missing?: boolean;
  className?: string;
  children: (id: string, missing: boolean) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-center">
        <label htmlFor={id} className="text-xs font-medium text-fg-2">
          {label}
        </label>
        <Help label={label} {...help} />
      </span>
      {children(id, missing)}
    </div>
  );
}

const warn = "border-warn bg-warn-soft";

export function TextAnswer({
  label,
  help,
  value,
  onChange,
  placeholder,
  disabled,
  missing = false,
  multiline = false,
  className,
}: {
  label: string;
  help: FpHelp;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  missing?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} help={help} className={className}>
      {(id) =>
        multiline ? (
          <Textarea id={id} rows={2} value={value} disabled={disabled} placeholder={placeholder} className={missing ? warn : undefined} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input id={id} value={value} disabled={disabled} placeholder={placeholder} className={missing ? warn : undefined} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

export function PickAnswer({
  label,
  help,
  value,
  onChange,
  options,
  disabled,
  missing = false,
  className,
}: {
  label: string;
  help: FpHelp;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  missing?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} help={help} className={className}>
      {(id) => (
        <NativeSelect id={id} value={value} disabled={disabled} className={missing ? warn : undefined} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/** Two to four buttons, one picked (the Truth / Assumption switch, a requirement's verdict). */
export function Choice<T extends string>({
  label,
  help,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  help: FpHelp;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center text-xs font-medium text-fg-2">
        {label}
        <Help label={label} {...help} />
      </span>
      <div role="group" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn("px-2.5 py-1 text-xs font-medium not-first:border-l not-first:border-line", value === o.value ? "bg-accent text-accent-fg" : "bg-panel text-fg-2 hover:bg-panel-2", "disabled:opacity-60")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A number typed in the unit a person reads (a win rate in %), stored in the engine's unit by the caller. */
export function NumberAnswer({
  label,
  help,
  value,
  onChange,
  unit,
  disabled,
  missing = false,
  className,
}: {
  label: string;
  help: FpHelp;
  /** What is stored, or null when empty. */
  value: number | null;
  /** Called with the number typed, or null when the box is empty or isn't a number. */
  onChange: (v: number | null) => void;
  unit?: string;
  disabled?: boolean;
  missing?: boolean;
  className?: string;
}) {
  // The text as typed, so "2." and "" survive until the number is complete.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : String(value));
  return (
    <Field label={label} help={help} className={className}>
      {(id) => (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            className={cn("max-w-32", missing ? warn : undefined)}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              onChange(e.target.value.trim() !== "" && Number.isFinite(n) ? n : null);
            }}
            onBlur={() => setText(null)}
          />
          {unit && <span className="text-xs text-fg-2">{unit}</span>}
        </div>
      )}
    </Field>
  );
}

/** "+ Add …" with an (i) saying what belongs in the list. */
export function AddButton({ label, help, onClick, disabled }: { label: string; help: FpHelp; onClick: () => void; disabled?: boolean }) {
  return (
    <span className="flex items-center self-start">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
        + {label}
      </Button>
      <Help label={label} {...help} />
    </span>
  );
}

export function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={onClick} aria-label={`Remove ${label}`} className="text-fg-2">
      Remove
    </Button>
  );
}

/** A card for one item of a list. */
export function ItemCard({ children, tone }: { children: ReactNode; tone?: "back" }) {
  return <div className={cn("flex flex-col gap-3 rounded-token border border-line bg-panel p-3", tone === "back" && "border-good bg-good-soft")}>{children}</div>;
}
