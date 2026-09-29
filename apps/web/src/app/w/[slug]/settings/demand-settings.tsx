"use client";

import { useActionState, useState, useTransition } from "react";
import { seasonalityCurve, type LeadSourceRow, type ProvenanceMap } from "@transpera-flow/db";
import { NumberField, TextField } from "@/components/fields";
import type { WorkspaceSettingsData } from "@/lib/data";
import {
  demandSummary,
  MAX_GROWTH,
  MAX_MULTIPLIER,
  MAX_VOLUME_WEEK,
  MIN_GROWTH,
  MONTH_NAMES,
  provenanceOf,
  type LeadSourceField,
} from "@/lib/demand";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  createLeadSource,
  removeLeadSource,
  resetSeasonality,
  saveGrowth,
  saveLeadSourceField,
  saveSeasonality,
  type ActionResult,
} from "./actions";

type Scalar = string | number | boolean | null;

/** A saver for one column of one lead source. */
const sourceSaver =
  <T extends Scalar>(sourceId: string, field: LeadSourceField): Saver<T> =>
  (base, next) =>
    saveLeadSourceField(sourceId, field, base, next) as Promise<SaveOutcome<T>>;

const sectionClass = "mb-8 rounded-token border border-line bg-panel p-4 shadow-token";

const PROVENANCE_LABEL = { estimated: "Estimated", entered: "Entered", measured: "Measured" } as const;
const PROVENANCE_CLASS = {
  estimated: "border-warn bg-warn-soft",
  entered: "border-line bg-panel-2",
  measured: "border-good bg-good-soft",
} as const;

/** Where a value came from: estimated (an assumption to confirm), entered by a person, or measured from data. */
function ProvenanceBadge({ provenance, field }: { provenance: ProvenanceMap | null | undefined; field: string }) {
  const source = provenanceOf(provenance, field);
  const entry = provenance?.[field];
  const when = entry?.at ? new Date(entry.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const title = [PROVENANCE_LABEL[source], when && `on ${when}`, entry?.note].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={`inline-block rounded-token border px-1.5 text-[11px] leading-4 text-fg-2 ${PROVENANCE_CLASS[source]}`}
    >
      {PROVENANCE_LABEL[source]}
    </span>
  );
}

export function DemandSettings({ data }: { data: WorkspaceSettingsData }) {
  const { leadSources, canEdit } = data;
  const summary = demandSummary(leadSources, data.services, data.workspace.settings.leads_per_week);
  return (
    <section className={sectionClass} aria-labelledby="demand-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="demand-heading" className="text-base font-bold">
          Demand
        </h2>
        <p className="text-fg-3">
          Where leads come from and how demand moves through the year. Simulations draw new leads from these.
        </p>
      </div>

      <p className="mb-4 rounded-token bg-panel-2 p-2" aria-live="polite">
        <strong className="tabular-nums">{formatNumber(summary.perWeek, 2)}</strong> qualified leads a week
        {summary.fromSources === null
          ? " (the workspace's interim figure: add a lead source to replace it)"
          : " from the lead sources below"}
        {summary.byService.length > 0 && (
          <span className="text-fg-2">
            , split by the services mix:{" "}
            {summary.byService.map((sv) => `${sv.name} ${formatNumber(sv.perWeek, 2)} (${formatPercent(sv.share)})`).join(", ")}
          </span>
        )}
        . Seasonality and growth then raise or lower it month by month.
      </p>

      {!canEdit && <p className="mb-3 text-fg-2">You can view demand here; owners and editors can change it.</p>}

      <h3 className="mb-2 font-semibold">Lead sources</h3>
      {canEdit && <AddLeadSource workspaceId={data.workspace.id} />}
      {leadSources.length === 0 ? (
        <p className="mb-6 rounded-token border border-dashed border-line p-4 text-fg-2">
          No lead sources yet. Until you add one, simulations use {formatNumber(data.workspace.settings.leads_per_week, 2)}{" "}
          leads a week.
        </p>
      ) : (
        <ul className="mb-6 flex flex-col divide-y divide-line border-y border-line">
          {leadSources.map((src) => (
            <li key={src.id}>
              <LeadSourceItem source={src} disabled={!canEdit} />
            </li>
          ))}
        </ul>
      )}

      <Seasonality data={data} />
      <Growth data={data} />
    </section>
  );
}

function AddLeadSource({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createLeadSource.bind(null, workspaceId), {});
  const input = "rounded-token border border-line bg-panel px-2 py-1.5";
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input name="name" required maxLength={200} placeholder="e.g. Website enquiries" className={input} />
      </label>
      <label className="flex w-32 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Leads a week</span>
        <input name="volume_week" type="number" inputMode="decimal" min={0} max={MAX_VOLUME_WEEK} step="any" required className={`${input} tabular-nums`} />
      </label>
      <label className="flex w-32 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Qualified (%)</span>
        <input
          name="conversion_pct"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="any"
          placeholder="100"
          className={`${input} tabular-nums`}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add lead source"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

function LeadSourceItem({ source: src, disabled }: { source: LeadSourceRow; disabled: boolean }) {
  const qualified = Number(src.volume_week) * Number(src.conversion_to_qualified);
  return (
    <div className="grid items-start gap-4 px-1 py-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
      <TextField label="Name" value={src.name} save={sourceSaver(src.id, "name")} disabled={disabled} />
      <NumberField
        label="Leads a week"
        value={Number(src.volume_week)}
        save={sourceSaver(src.id, "volume_week")}
        min={0}
        max={MAX_VOLUME_WEEK}
        step={1}
        disabled={disabled}
        hint={<ProvenanceBadge provenance={src.provenance} field="volume_week" />}
      />
      <NumberField
        label="Become qualified"
        value={Number(src.conversion_to_qualified)}
        save={sourceSaver(src.id, "conversion_to_qualified")}
        scale={100}
        unit="%"
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        hint={<ProvenanceBadge provenance={src.provenance} field="conversion_to_qualified" />}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Qualified a week</span>
        <span className="py-1.5 tabular-nums">{formatNumber(qualified, 2)}</span>
        {!disabled && <RemoveLeadSource sourceId={src.id} name={src.name} />}
      </div>
    </div>
  );
}

function RemoveLeadSource({ sourceId, name }: { sourceId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="self-start text-xs text-fg-3 underline hover:text-crit">
        Remove
      </button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1 text-xs">
      <span>Remove {name}?</span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await removeLeadSource(sourceId);
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
      </span>
      {error && (
        <p role="alert" className="text-crit">
          {error}
        </p>
      )}
    </div>
  );
}

function Seasonality({ data }: { data: WorkspaceSettingsData }) {
  const { seasonality, canEdit } = data;
  const workspaceId = data.workspace.id;
  const curve = seasonalityCurve(seasonality);
  const rowFor = new Map(seasonality.map((r) => [r.month, r]));
  const peak = Math.max(1, ...curve);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-semibold">Seasonality</h3>
        <p className="text-fg-3">
          A multiplier on leads for each calendar month: 1 is a normal month, 1.3 is 30% busier, 0 is none.
        </p>
      </div>
      {/* The saved curve at a glance; the dashed line is a normal month. */}
      <div aria-hidden className="relative mb-3 flex h-16 items-end gap-1 border-b border-line">
        <div className="absolute inset-x-0 border-t border-dashed border-fg-3" style={{ bottom: `${(1 / peak) * 100}%` }} />
        {curve.map((m, i) => (
          <div key={MONTH_NAMES[i]} className="flex h-full flex-1 flex-col justify-end">
            <div className={`rounded-t-sm ${m === 1 ? "bg-line-2" : "bg-accent"}`} style={{ height: `${(m / peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {curve.map((multiplier, i) => {
          const month = i + 1;
          return (
            <NumberField
              key={month}
              label={MONTH_NAMES[i]!}
              value={multiplier}
              save={(base, next) => saveSeasonality(workspaceId, month, base, next)}
              unit="×"
              min={0}
              max={MAX_MULTIPLIER}
              step={0.05}
              disabled={!canEdit}
              hint={<ProvenanceBadge provenance={rowFor.get(month)?.provenance} field="multiplier" />}
            />
          );
        })}
      </div>
      {canEdit && seasonality.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resetSeasonality(workspaceId);
                setError(r.error);
              })
            }
            className="text-fg-3 underline hover:text-fg disabled:opacity-60"
          >
            {pending ? "Resetting…" : "Reset to flat (every month 1)"}
          </button>
          {error && (
            <p role="alert" className="text-crit">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Growth({ data }: { data: WorkspaceSettingsData }) {
  const { demand, canEdit } = data;
  const workspaceId = data.workspace.id;
  return (
    <div>
      <h3 className="mb-2 font-semibold">Growth</h3>
      <div className="max-w-xs">
        <NumberField
          label="Monthly growth in leads"
          value={demand ? Number(demand.growth_monthly) : 0}
          save={(base, next) => saveGrowth(workspaceId, base, next)}
          scale={100}
          unit="% a month"
          min={MIN_GROWTH * 100}
          max={MAX_GROWTH * 100}
          step={0.5}
          disabled={!canEdit}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <ProvenanceBadge provenance={demand?.provenance} field="growth_monthly" />
              Compounds each calendar month from the start of a run; negative for a decline.
            </span>
          }
        />
      </div>
    </div>
  );
}
