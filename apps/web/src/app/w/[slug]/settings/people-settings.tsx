"use client";

import { useActionState, useState, useTransition } from "react";
import { DEFAULT_AVAILABILITY_FLOOR } from "@transpera-flow/engine";
import { ChecklistField, DateField, NumberField, TextField, ToggleField } from "@/components/fields";
import type { PersonDetail, WorkspaceSettingsData } from "@/lib/data";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatNumber } from "@/lib/format";
import {
  addLeave,
  createPerson,
  removeLeave,
  saveAvailabilityFloor,
  savePersonField,
  savePersonSet,
  type ActionResult,
  type PersonField,
} from "./actions";

type Scalar = string | number | boolean | null;

/** A saver for one column of one person. */
const personSaver =
  <T extends Scalar>(personId: string, field: PersonField): Saver<T> =>
  (base, next) =>
    savePersonField(personId, field, base, next) as Promise<SaveOutcome<T>>;

const sectionClass = "mb-8 rounded-token border border-line bg-panel p-4 shadow-token";

export function SimulationSettings({ data }: { data: WorkspaceSettingsData }) {
  const { workspace, canManage } = data;
  const floor = workspace.settings.availability_floor ?? null;
  return (
    <section className={sectionClass} aria-labelledby="simulation-heading">
      <h2 id="simulation-heading" className="mb-3 text-base font-bold">
        Simulation
      </h2>
      <div className="max-w-xs">
        <NumberField
          label="Availability floor"
          value={floor}
          save={(base, next) => saveAvailabilityFloor(workspace.id, base, next)}
          optional
          scale={100}
          unit="%"
          min={0}
          max={50}
          step={1}
          placeholder={`${DEFAULT_AVAILABILITY_FLOOR * 100} (default)`}
          disabled={!canManage}
          hint={
            canManage
              ? "Share of each person's week always left for pipeline work, however heavy client work gets. Blank uses the default."
              : "Only workspace owners can change this."
          }
        />
      </div>
    </section>
  );
}

export function PeopleSettings({ data }: { data: WorkspaceSettingsData }) {
  const active = data.people.filter((p) => p.active);
  const inactive = data.people.filter((p) => !p.active);
  return (
    <section className={sectionClass} aria-labelledby="people-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="people-heading" className="text-base font-bold">
          People
        </h2>
        <p className="text-fg-3">
          {active.length} active{inactive.length ? `, ${inactive.length} inactive` : ""}. Modelled for capacity, not
          performance.
        </p>
      </div>
      {data.canEdit ? (
        <AddPerson data={data} />
      ) : (
        <p className="mb-3 text-fg-2">You can view people here; owners and editors can change them.</p>
      )}
      {data.people.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-4 text-fg-2">
          No people yet. Until you add some, each role&apos;s head-count is used instead.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {[...active, ...inactive].map((p) => (
            <li key={p.id}>
              <PersonRow person={p} data={data} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddPerson({ data }: { data: WorkspaceSettingsData }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createPerson.bind(null, data.workspace.id), {});
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input name="name" required maxLength={200} className="rounded-token border border-line bg-panel px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Role</span>
        <select name="role_id" className="rounded-token border border-line bg-panel px-2 py-1.5">
          <option value="">No role yet</option>
          {data.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add person"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

function PersonRow({ person: p, data }: { person: PersonDetail; data: WorkspaceSettingsData }) {
  const roleIds = data.personRoles.filter((r) => r.person_id === p.id).map((r) => r.role_id);
  const skillIds = data.personSkills.filter((s) => s.person_id === p.id).map((s) => s.step_id);
  const leave = data.personLeave.filter((l) => l.person_id === p.id);
  const roleNames = data.roles.filter((r) => roleIds.includes(r.id)).map((r) => r.name);
  const hoursPerWeek = data.workspace.settings.hours_per_week;
  const capacity = p.capacity_hours_week ?? Number(p.fte) * hoursPerWeek;
  const disabled = !data.canEdit;
  const roleName = new Map(data.roles.map((r) => [r.id, r.name]));

  return (
    <details className="group py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-token px-1 py-1 hover:bg-panel-2">
        <span aria-hidden className="text-fg-3 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className={`font-semibold ${p.active ? "" : "text-fg-3 line-through"}`}>{p.name}</span>
        <span className="text-fg-2">{roleNames.join(", ") || "No role"}</span>
        <span className="text-fg-3 tabular-nums">
          {formatNumber(Number(p.fte), 2)} FTE · {formatNumber(Number(capacity), 1)} h/week
        </span>
        {leave.length > 0 && <span className="text-fg-3">{leave.length} leave</span>}
        {!p.active && <span className="rounded-token bg-panel-2 px-1.5 text-xs text-fg-2">Inactive</span>}
      </summary>

      <div className="grid gap-4 px-1 pt-3 pb-2 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Name" value={p.name} save={personSaver(p.id, "name")} disabled={disabled} />
        <TextField label="Email" type="email" value={p.email} save={personSaver(p.id, "email")} optional disabled={disabled} />
        <ToggleField
          label="Status"
          value={p.active}
          save={personSaver(p.id, "active")}
          onLabel="Active"
          offLabel="Inactive: left out of simulations"
          disabled={disabled}
        />
        <NumberField
          label="FTE"
          value={Number(p.fte)}
          save={personSaver(p.id, "fte")}
          min={0.05}
          max={1.5}
          step={0.1}
          disabled={disabled}
        />
        <NumberField
          label="Capacity"
          value={p.capacity_hours_week === null ? null : Number(p.capacity_hours_week)}
          save={personSaver(p.id, "capacity_hours_week")}
          optional
          unit="h/week"
          min={0.5}
          max={80}
          step={0.5}
          placeholder={`${formatNumber(Number(p.fte) * hoursPerWeek, 1)} from FTE`}
          hint="Blank: FTE × the workspace week."
          disabled={disabled}
        />
        <NumberField
          label="Cost rate"
          value={p.cost_rate === null ? null : Number(p.cost_rate)}
          save={personSaver(p.id, "cost_rate")}
          optional
          unit={`${data.workspace.settings.currency}/h`}
          min={0}
          step={1}
          placeholder="Role default"
          disabled={disabled}
        />
        <DateField label="Start date" value={p.start_date} save={personSaver(p.id, "start_date")} disabled={disabled} />
        <DateField label="End date" value={p.end_date} save={personSaver(p.id, "end_date")} disabled={disabled} />
        <TextField label="Notes" value={p.notes} save={personSaver(p.id, "notes")} optional multiline disabled={disabled} />

        <div className="sm:col-span-2 lg:col-span-3">
          <ChecklistField
            label="Roles"
            value={roleIds}
            save={(base, next) => savePersonSet(p.id, p.workspace_id, "roles", [...base], [...next])}
            options={data.roles.map((r) => ({ id: r.id, label: r.name }))}
            emptyLabel="no roles"
            disabled={disabled}
          />
        </div>
        {data.steps.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ChecklistField
              label="Skills: steps they can do"
              value={skillIds}
              save={(base, next) => savePersonSet(p.id, p.workspace_id, "skills", [...base], [...next])}
              options={data.steps.map((s) => ({
                id: s.id,
                label: s.name,
                sublabel: s.role_id ? roleName.get(s.role_id) : undefined,
              }))}
              hint="None ticked: every step of their roles."
              emptyLabel="every step of their roles"
              disabled={disabled}
            />
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <Leave personId={p.id} workspaceId={p.workspace_id} leave={leave} disabled={disabled} />
        </div>
      </div>
    </details>
  );
}

function Leave({
  personId,
  workspaceId,
  leave,
  disabled,
}: {
  personId: string;
  workspaceId: string;
  leave: WorkspaceSettingsData["personLeave"];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addLeave.bind(null, personId, workspaceId), {});
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string>();
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-fg-2">Leave</legend>
      {leave.length === 0 ? (
        <p className="text-fg-3">No leave booked.</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {leave.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3">
              <span className="tabular-nums">
                {l.start_date === l.end_date ? l.start_date : `${l.start_date} to ${l.end_date}`}
              </span>
              {l.note && <span className="text-fg-2">{l.note}</span>}
              {!disabled && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemoving(async () => {
                      const r = await removeLeave(l.id);
                      setRemoveError(r.error);
                    })
                  }
                  className="text-fg-3 underline hover:text-crit disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p role="alert" className="text-crit">
          {removeError}
        </p>
      )}
      {!disabled && (
        <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">First day</span>
            <input type="date" name="start_date" required className="rounded-token border border-line bg-panel px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Last day</span>
            <input type="date" name="end_date" className="rounded-token border border-line bg-panel px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Note</span>
            <input name="note" maxLength={200} className="rounded-token border border-line bg-panel px-2 py-1" />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-token border border-line px-3 py-1 font-medium hover:bg-panel-2 disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add leave"}
          </button>
          {state.error && (
            <p role="alert" className="w-full text-crit">
              {state.error}
            </p>
          )}
        </form>
      )}
    </fieldset>
  );
}
