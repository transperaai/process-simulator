"use client";

import { useActionState, useState, useTransition } from "react";
import type { RoleRow } from "@transpera-flow/db";
import { TextField, ToggleField } from "@/components/fields";
import type { WorkspaceSettingsData } from "@/lib/data";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { inUse, type RoleField, type RoleUsage } from "@/lib/roles";
import { createRole, removeRole, saveRoleField, type ActionResult } from "./actions";

type Scalar = string | number | boolean | null;

/** A saver for one column of one role. */
const roleSaver =
  <T extends Scalar>(roleId: string, field: RoleField): Saver<T> =>
  (base, next) =>
    saveRoleField(roleId, field, base, next) as Promise<SaveOutcome<T>>;

const sectionClass = "mb-8 rounded-token border border-line bg-panel p-4 shadow-token";
const noUsage: RoleUsage = { steps: 0, people: 0, clients: 0 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RolesSettings({ data }: { data: WorkspaceSettingsData }) {
  const { roles, canEdit } = data;
  return (
    <section className={sectionClass} aria-labelledby="roles-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="roles-heading" className="text-base font-bold">
          Roles
        </h2>
        <p className="text-fg-3">
          Kinds of work. Steps, people and client assignments name roles. A role that is in use can&apos;t be removed; make it
          inactive to hide it from pickers.
        </p>
      </div>
      {canEdit ? (
        <AddRole workspaceId={data.workspace.id} />
      ) : (
        <p className="mb-3 text-fg-2">You can view roles here; owners and editors can change them.</p>
      )}
      {roles.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-4 text-fg-2">No roles yet. Add the kinds of work your team does.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {roles.map((r) => (
            <li key={r.id}>
              <RoleItem role={r} usage={data.roleUsage[r.id] ?? noUsage} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddRole({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createRole.bind(null, workspaceId), {});
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input name="name" required maxLength={200} className="rounded-token border border-line bg-panel px-2 py-1.5" />
      </label>
      <button type="submit" disabled={pending} className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60">
        {pending ? "Adding…" : "Add role"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

function RoleItem({ role, usage, canEdit }: { role: Pick<RoleRow, "id" | "name" | "color" | "active">; usage: RoleUsage; canEdit: boolean }) {
  const disabled = !canEdit;
  return (
    <details className="group py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-token px-1 py-1 hover:bg-panel-2">
        <span aria-hidden className="text-fg-3 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className={`font-semibold ${role.active ? "" : "text-fg-3 line-through"}`}>{role.name}</span>
        {!role.active && <span className="rounded-token bg-panel-2 px-1.5 text-xs text-fg-2">Inactive</span>}
      </summary>
      <div className="grid gap-4 px-1 pt-3 pb-2 sm:grid-cols-2">
        <TextField label="Name" value={role.name} save={roleSaver(role.id, "name")} disabled={disabled} />
        <ToggleField
          label="Status"
          value={role.active}
          save={roleSaver(role.id, "active")}
          onLabel="Active"
          offLabel="Inactive: hidden from pickers; steps, people and clients that have it keep it"
          disabled={disabled}
        />
        <p className="text-fg-2 sm:col-span-2">
          Used by {plural(usage.steps, "step")} · {plural(usage.people, "person", "people")} · {plural(usage.clients, "client")}
        </p>
        {canEdit && !inUse(usage) && (
          <div className="sm:col-span-2">
            <RemoveRole roleId={role.id} name={role.name} />
          </div>
        )}
      </div>
    </details>
  );
}

function RemoveRole({ roleId, name }: { roleId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-fg-3 underline hover:text-crit">
        Remove role
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Remove {name}? This can&apos;t be undone.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await removeRole(roleId);
            setError(r.error);
          })
        }
        className="rounded-token border border-crit px-2 py-0.5 font-medium text-crit disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-token border border-line px-2 py-0.5">
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
