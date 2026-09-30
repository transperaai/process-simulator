"use client";

import { useActionState, useState, useTransition } from "react";
import type { PricingModel, ServiceRow } from "@transpera-flow/db";
import { NumberField, SelectField, TextField, ToggleField } from "@/components/fields";
import type { WorkspaceSettingsData } from "@/lib/data";
import { mapOutcome, type SaveOutcome, type Saver } from "@/lib/fields/field-controller";
import { formatCurrency, formatPercent } from "@/lib/format";
import { formatTags, mixPercentages, parseTags, PRICING_LABELS, PRICING_MODELS, type ServiceField } from "@/lib/services";
import { createService, removeService, saveServiceFallback, saveServiceField, saveServiceTags, type ActionResult } from "./actions";
import { ServicingLinks } from "./servicing-settings";

type Scalar = string | number | boolean | null;

/** A saver for one column of one service. */
const serviceSaver =
  <T extends Scalar>(serviceId: string, field: ServiceField): Saver<T> =>
  (base, next) =>
    saveServiceField(serviceId, field, base, next) as Promise<SaveOutcome<T>>;

/** Path tags edited as "seo, ppc" and saved as a list. */
const tagsSaver =
  (serviceId: string): Saver<string | null> =>
  async (base, next) =>
    mapOutcome(await saveServiceTags(serviceId, parseTags(base ?? ""), parseTags(next ?? "")), (tags) =>
      tags.length ? formatTags(tags) : null,
    );

const sectionClass = "mb-8 rounded-token border border-line bg-panel p-4 shadow-token";
const pricingOptions = PRICING_MODELS.map((m) => ({ value: m, label: PRICING_LABELS[m] }));

/** "per month", "one-off" or "per hour", for a price. */
const priceUnit = (model: PricingModel) => (model === "retainer" ? "/month" : model === "hourly" ? "/hour" : " one-off");

export function ServicesSettings({ data }: { data: WorkspaceSettingsData }) {
  const { services, canEdit } = data;
  const mix = mixPercentages(services);
  const currency = data.workspace.settings.currency;
  return (
    <section className={sectionClass} aria-labelledby="services-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="services-heading" className="text-base font-bold">
          Services
        </h2>
        <p className="text-fg-3">
          What you sell. Each new lead is given a service from the mix, follows its path tags, and is priced by it
          when won.
        </p>
      </div>
      {canEdit ? (
        <AddService workspaceId={data.workspace.id} />
      ) : (
        <p className="mb-3 text-fg-2">You can view services here; owners and editors can change them.</p>
      )}
      {services.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-4 text-fg-2">
          No services yet. Until you add one, every win is priced at the workspace&apos;s retainer of{" "}
          {formatCurrency(data.workspace.settings.retainer, currency)} a month.
        </p>
      ) : (
        <>
          {!mix && (
            <p role="alert" className="mb-3 rounded-token border border-warn bg-warn-soft p-2">
              Every active service has a mix share of 0, so the process can&apos;t be simulated. Give at least one a
              share.
            </p>
          )}
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {services.map((sv) => (
              <li key={sv.id}>
                <ServiceItem service={sv} share={mix?.get(sv.id)} data={data} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AddService({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createService.bind(null, workspaceId), {});
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input name="name" required maxLength={200} className="rounded-token border border-line bg-panel px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Pricing</span>
        <select name="pricing_model" className="rounded-token border border-line bg-panel px-2 py-1.5">
          {pricingOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-28 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Price</span>
        <input
          name="price"
          type="number"
          inputMode="decimal"
          min={0}
          step={50}
          className="rounded-token border border-line bg-panel px-2 py-1.5 tabular-nums"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add service"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

function ServiceItem({ service: sv, share, data }: { service: ServiceRow; share: number | undefined; data: WorkspaceSettingsData }) {
  const disabled = !data.canEdit;
  const currency = data.workspace.settings.currency;
  const pipelines = data.processes.filter((p) => p.kind === "pipeline");
  const tagHint = data.conditionTags.length
    ? `Comma-separated. Tags on your connections: ${data.conditionTags.join(", ")}.`
    : "Comma-separated. No connections are tagged yet; tag a branch on the map to route by service.";
  const retainer = sv.pricing_model === "retainer";

  return (
    <details className="group py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-token px-1 py-1 hover:bg-panel-2">
        <span aria-hidden className="text-fg-3 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className={`font-semibold ${sv.active ? "" : "text-fg-3 line-through"}`}>{sv.name}</span>
        <span className="text-fg-2 tabular-nums">
          {formatCurrency(Number(sv.price), currency)}
          {priceUnit(sv.pricing_model)}
        </span>
        <span className="text-fg-3 tabular-nums">
          {share !== undefined ? `${formatPercent(share)} of leads` : "not in the mix"}
          {sv.path_tags.length ? ` · follows ${formatTags(sv.path_tags)}` : ""}
        </span>
        {!sv.active && <span className="rounded-token bg-panel-2 px-1.5 text-xs text-fg-2">Inactive</span>}
      </summary>

      <div className="grid gap-4 px-1 pt-3 pb-2 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Name" value={sv.name} save={serviceSaver(sv.id, "name")} disabled={disabled} />
        <SelectField
          label="Pricing model"
          value={sv.pricing_model}
          save={serviceSaver(sv.id, "pricing_model")}
          options={pricingOptions}
          disabled={disabled}
          hint="Only retainers add new MRR. Hourly services add no revenue until servicing work is simulated."
        />
        <NumberField
          label="Price"
          value={Number(sv.price)}
          save={serviceSaver(sv.id, "price")}
          unit={`${currency}${priceUnit(sv.pricing_model)}`}
          min={0}
          step={50}
          disabled={disabled}
        />
        <NumberField
          label="Margin"
          value={Number(sv.margin)}
          save={serviceSaver(sv.id, "margin")}
          scale={100}
          unit="%"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          hint="Gross margin as a share of price. Recorded for reporting; not in the revenue figures yet."
        />
        <NumberField
          label="Expected tenure"
          value={Number(sv.tenure_months)}
          save={serviceSaver(sv.id, "tenure_months")}
          unit="months"
          min={0}
          max={600}
          step={1}
          disabled={disabled}
          hint={retainer ? "How long a client stays: LTV and lost revenue use price × tenure." : "Used for retainers only."}
        />
        <NumberField
          label="Base churn"
          value={Number(sv.churn_monthly_base)}
          save={serviceSaver(sv.id, "churn_monthly_base")}
          scale={100}
          unit="%/month"
          min={0}
          max={100}
          step={0.5}
          disabled={disabled}
          hint="Monthly churn of a client in full health; revenue billed in the horizon stops when a client leaves."
        />
        <NumberField
          label="Churn sensitivity to health"
          value={sv.churn_health_sensitivity === undefined ? null : Number(sv.churn_health_sensitivity)}
          save={serviceSaver(sv.id, "churn_health_sensitivity")}
          min={0}
          max={100}
          step={0.5}
          disabled={disabled}
          hint="Monthly churn = base × (1 + this × (100 − health) / 100). The default 3 is an estimate: a client at health 50 churns 2.5× the base."
        />
        <NumberField
          label="Mix share"
          value={Number(sv.mix_share)}
          save={serviceSaver(sv.id, "mix_share")}
          min={0}
          step={0.05}
          disabled={disabled}
          hint={
            share !== undefined
              ? `Relative weight; ${formatPercent(share)} of new leads across the active services.`
              : "Relative weight among the active services."
          }
        />
        <SelectField
          label="Entry"
          value={sv.entry_process_id}
          save={serviceSaver(sv.id, "entry_process_id")}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          noneLabel="The pipeline (default)"
          disabled={disabled}
          hint="The process its leads arrive at; they start at its first step."
        />
        <ToggleField
          label="Status"
          value={sv.active}
          save={serviceSaver(sv.id, "active")}
          onLabel="Active"
          offLabel="Inactive: left out of simulations"
          disabled={disabled}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <TextField
            label="Path tags"
            value={sv.path_tags.length ? formatTags(sv.path_tags) : null}
            save={tagsSaver(sv.id)}
            optional
            disabled={disabled}
            hint={`${tagHint} A lead on this service takes the connections tagged with one of these.`}
          />
        </div>
        <ServicingLinks service={sv} data={data} />
        <FallbackLoad service={sv} data={data} />
        {!disabled && (
          <div className="sm:col-span-2 lg:col-span-3">
            <RemoveService serviceId={sv.id} name={sv.name} />
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Hours a month each client on this service needs from each role, while no
 * servicing process is mapped (docs/PRD.md §6.3.4; issue #18). They go to the
 * client's assigned person for the role (Clients page).
 */
function FallbackLoad({ service: sv, data }: { service: ServiceRow; data: WorkspaceSettingsData }) {
  const load = sv.fallback_ongoing_load ?? {};
  const any = Object.values(load).some((h) => typeof h === "number");
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className="mb-1 text-xs font-medium text-fg-2">Ongoing load per client (hours a month, by role)</legend>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.roles.map((r) => (
          <NumberField
            key={r.id}
            label={r.name}
            value={typeof load[r.id] === "number" ? load[r.id]! : null}
            save={(base, next) => saveServiceFallback(sv.id, r.id, base, next)}
            optional
            min={0}
            max={1000}
            step={0.5}
            unit="h"
            disabled={!data.canEdit}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-fg-3">
        {any
          ? "Each client on this service needs these hours from the person looking after it for that role; a blank role needs none."
          : "None set: each client needs every role's hours per client a week instead (the pooled estimate)."}{" "}
        Used until a servicing process is mapped.
      </p>
    </fieldset>
  );
}

function RemoveService({ serviceId, name }: { serviceId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-fg-3 underline hover:text-crit">
        Remove service
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Remove {name}? This can&apos;t be undone; to keep it but leave it out of simulations, make it inactive.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await removeService(serviceId);
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
