"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Help, type HelpProps } from "@/components/help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/workspaces";
import { createWorkspace, type CreateWorkspaceState } from "./actions";

type HelpText = Pick<HelpProps, "description" | "example">;

/** A label with its (i), over the control it names. */
function Field({ label, help, className, children }: { label: string; help: HelpText; className?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-center">
        <label htmlFor={id} className="text-xs font-medium text-fg-2">
          {label}
        </label>
        <Help label={label} {...help} />
      </span>
      {children(id)}
    </div>
  );
}

/** The new-workspace form. The address follows the name until someone edits it. */
export function NewWorkspaceForm() {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field
        label="Name"
        className="flex-1 basis-56"
        help={{ description: "What the company is called. It appears at the top of the sidebar.", example: "Northbeam Digital" }}
      >
        {(id) => (
          <Input
            id={id}
            name="name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        )}
      </Field>
      <Field
        label="Address"
        className="flex-1 basis-56"
        help={{ description: "The web address of the workspace. It follows the name until you change it. Use lowercase letters, numbers and dashes.", example: "northbeam-digital gives /w/northbeam-digital." }}
      >
        {(id) => (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">/w/</span>
            <Input
              id={id}
              name="slug"
              maxLength={60}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              className="min-w-0 flex-1"
            />
          </span>
        )}
      </Field>
      <Field
        label="Hours a week"
        className="w-32"
        help={{ description: "How many hours make a full working week here. A person at full time (FTE 1) has this many hours.", example: "Leave blank for 40. A company on a 37.5-hour week enters 37.5." }}
      >
        {(id) => <Input id={id} name="hours_per_week" type="number" inputMode="decimal" min={1} max={168} step="any" placeholder="40" className="tabular-nums" />}
      </Field>
      <Field
        label="Currency"
        className="w-28"
        help={{ description: "The three-letter code for the currency your prices and costs are in.", example: "Leave blank for AUD (Australian dollars). GBP is pounds, USD is dollars." }}
      >
        {(id) => <Input id={id} name="currency" maxLength={3} placeholder="AUD" className="uppercase" />}
      </Field>
      <Field
        label="Horizon (weeks)"
        className="w-36"
        help={{ description: "How far ahead each simulation looks, in weeks. You can change the view later.", example: "Leave blank for 13 weeks, about a quarter. Use 26 for six months." }}
      >
        {(id) => <Input id={id} name="horizon_weeks" type="number" inputMode="numeric" min={1} max={104} step={1} placeholder="13" className="tabular-nums" />}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
      {state.error && (
        <p role="alert" className="w-full text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
