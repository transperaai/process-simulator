"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { RecurrenceJson, ServiceRow } from "@transpera-flow/db";
import { NumberField, SelectField } from "@/components/fields";
import type { WorkspaceSettingsData } from "@/lib/data";
import { HEALTH_SETTINGS, recurrenceFromValue, recurrenceOptions, type HealthSetting } from "@/lib/servicing";
import { linkServicingProcess, saveHealthSetting, saveServicingRecurrence, saveServicingSla, unlinkServicingProcess } from "./servicing-actions";

const sectionClass = "mb-8 rounded-token border border-line bg-panel p-4 shadow-token";

/**
 * The servicing processes a service's clients run (docs/PRD.md §5
 * `service_servicing`, §6.3.5; issue #19): how often each client gets a task
 * and the SLA it is measured against. Linking one replaces the service's
 * fallback load per client.
 */
export function ServicingLinks({ service: sv, data }: { service: ServiceRow; data: WorkspaceSettingsData }) {
  const links = data.servicingLinks.filter((l) => l.service_id === sv.id);
  const servicing = data.processes.filter((p) => p.kind === "servicing");
  const name = new Map(data.processes.map((p) => [p.id, p.name]));
  const unlinked = servicing.filter((p) => !links.some((l) => l.process_id === p.id));
  const hoursPerDay = data.workspace.settings.hours_per_week / 5;
  const disabled = !data.canEdit;
  const [adding, setAdding] = useState(unlinked[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (f: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await f();
      setError(r.error);
    });
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className="mb-1 text-xs font-medium text-fg-2">Servicing processes</legend>
      {links.length ? (
        <ul className="flex flex-col gap-3">
          {links.map((l) => (
            <li key={l.id} className="grid items-end gap-3 rounded-token border border-line p-2 sm:grid-cols-[1fr_12rem_10rem_auto]">
              <p className="self-center font-medium">
                <Link href={`/w/${data.workspace.slug}/p/${l.process_id}`} className="underline">
                  {name.get(l.process_id) ?? "A process"}
                </Link>
              </p>
              <SelectField
                label="How often, per client"
                value={JSON.stringify(l.recurrence)}
                options={recurrenceOptions(l.recurrence as RecurrenceJson)}
                save={async (base, next) => {
                  const b = recurrenceFromValue(base);
                  const n = recurrenceFromValue(next);
                  if (!b || !n) return { status: "error", message: "Choose how often." };
                  return saveServicingRecurrence(l.id, b, n);
                }}
                disabled={disabled}
              />
              <NumberField
                label="On time within"
                value={Number(l.sla_hours)}
                save={(base, next) => saveServicingSla(l.id, base, next)}
                scale={1 / hoursPerDay}
                unit="working days"
                min={0.05}
                max={250}
                step={0.5}
                disabled={disabled}
              />
              {!disabled && (
                <button type="button" disabled={pending} onClick={() => run(() => unlinkServicingProcess(l.id))} className="mb-1 text-fg-3 underline hover:text-crit">
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-2">None: each client needs the fallback load below instead.</p>
      )}
      {!disabled &&
        (unlinked.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`link-${sv.id}`}>
              Servicing process to link
            </label>
            <select id={`link-${sv.id}`} value={adding} onChange={(e) => setAdding(e.target.value)} className="rounded-token border border-line bg-panel px-2 py-1">
              {unlinked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !adding}
              onClick={() => run(() => linkServicingProcess(data.workspace.id, sv.id, adding))}
              className="rounded-token border border-line px-2 py-1"
            >
              {pending ? "Linking…" : "Link"}
            </button>
          </div>
        ) : !servicing.length ? (
          <p className="mt-1 text-xs text-fg-3">
            No servicing processes yet: add one from the process page (+ Servicing process), then link it here.
          </p>
        ) : null)}
      {error && (
        <p role="alert" className="mt-1 text-crit">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-3">
        Every client on this service gets a task from each linked process this often. A task goes to the client&apos;s assigned person
        for each step&apos;s role (the role&apos;s other people while they&apos;re on leave). Done within the SLA, the client&apos;s health
        recovers; late or not done within twice it, health drops, and churn rises.
      </p>
    </fieldset>
  );
}

/** How servicing moves client health (docs/PRD.md §6.3.5): blank uses the estimated defaults. */
export function HealthSettings({ data }: { data: WorkspaceSettingsData }) {
  const { workspace, canManage } = data;
  const settings = workspace.settings as unknown as Record<string, number | undefined>;
  return (
    <section className={sectionClass} aria-labelledby="health-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="health-heading" className="text-base font-bold">
          Client health
        </h2>
        <p className="text-fg-3">
          How servicing tasks move a client&apos;s health (0–100). Monthly churn = the service&apos;s base churn × (1 + sensitivity ×
          (100 − health) / 100); below 50 a client is at risk. Blank uses the estimated default.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(HEALTH_SETTINGS) as HealthSetting[]).map((key) => {
          const rule = HEALTH_SETTINGS[key];
          const value = settings[key];
          return (
            <NumberField
              key={key}
              label={rule.label}
              value={typeof value === "number" ? value : null}
              save={(base, next) => saveHealthSetting(workspace.id, key, base, next)}
              optional
              unit={rule.unit}
              min={0}
              max={rule.max}
              step={1}
              placeholder={`${rule.fallback} (estimated)`}
              disabled={!canManage}
              hint={canManage ? rule.hint : "Only workspace owners can change this."}
            />
          );
        })}
      </div>
    </section>
  );
}
