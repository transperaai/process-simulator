"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import type { ClientRow } from "@transpera-flow/db";
import { ChecklistField, DateField, NumberField, SelectField, TextField, ToggleField } from "@/components/fields";
import type { RosterBackend } from "@/lib/clients/backend";
import { parseRosterCsv, type ParsedImport } from "@/lib/clients/csv";
import { DEFAULT_HEALTH, personClientLoads, rosterSummary, type PersonClientLoad, type RosterData } from "@/lib/clients/roster";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

type Scalar = string | number | boolean | null;

const sectionClass = "mb-6 rounded-token border border-line bg-panel p-4 shadow-token";

/** The client roster (docs/PRD.md §8 screen 5; issue #18): who the clients are, who looks after them, and the load that puts on each person. */
export function ClientsRoster({ data, backend }: { data: RosterData; backend: RosterBackend }) {
  const summary = rosterSummary(data);
  const currency = data.workspace.settings.currency;
  const [query, setQuery] = useState("");
  const shown = data.clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <p className="mb-4 text-fg-2">
        <span className="font-semibold text-fg">{summary.active} active clients</span> ·{" "}
        {formatCurrency(summary.mrr, currency)} MRR a month
        {data.services
          .filter((sv) => summary.byService.get(sv.id))
          .map((sv) => (
            <span key={sv.id}>
              {" "}
              · {sv.name} {summary.byService.get(sv.id)}
            </span>
          ))}
        {summary.inactive ? <span className="text-fg-3"> · {summary.inactive} inactive</span> : null}
      </p>
      <LoadPanel data={data} />
      <section className={sectionClass} aria-labelledby="roster-heading">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h2 id="roster-heading" className="text-base font-bold">
            Roster
          </h2>
          <p className="text-fg-3">Changes save as you go. Assign a person per role, or leave a role shared by its people.</p>
          <span className="flex-1" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a client"
            aria-label="Find a client"
            className="w-48 rounded-token border border-line bg-panel px-2 py-1"
          />
        </div>
        {data.canEdit ? (
          <div className="mb-4 flex flex-col gap-3">
            <AddClient data={data} backend={backend} />
            <PasteCsv data={data} backend={backend} />
          </div>
        ) : (
          <p className="mb-3 text-fg-2">You can view the roster; owners and editors can change it.</p>
        )}
        {data.clients.length === 0 ? (
          <p className="rounded-token border border-dashed border-line p-4 text-fg-2">
            No clients yet. Until you add some, the simulation uses the workspace&apos;s count of{" "}
            {data.workspace.settings.active_clients} clients, each needing every role&apos;s hours per client.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {shown.map((c) => (
              <li key={c.id}>
                <ClientItem client={c} data={data} backend={backend} />
              </li>
            ))}
            {!shown.length && <li className="py-3 text-fg-3">No client matches “{query}”.</li>}
          </ul>
        )}
      </section>
    </>
  );
}

const STATUS_LABEL: Record<PersonClientLoad["status"], string> = { ok: "Fits", overtime: "Needs overtime", over: "Over capacity" };

function LoadPanel({ data }: { data: RosterData }) {
  const loads = useMemo(() => personClientLoads(data), [data]);
  const cap = Number(data.workspace.settings.overtime_cap ?? 0);
  const roleName = new Map(data.roles.map((r) => [r.id, r.name]));
  const width = (share: number) => `${Math.max(0, Math.min(100, (share / 1.5) * 100))}%`;
  return (
    <section className={sectionClass} aria-labelledby="load-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="load-heading" className="text-base font-bold">
          Client load by person
        </h2>
        <p className="text-fg-3">
          Ongoing hours a week from the clients each person looks after, before any pipeline work. Services without a
          servicing process use their fallback load per client (Settings → Services).
          {cap > 0 ? ` Overtime cap: ${formatPercent(cap)} of a person's week.` : " No overtime allowed (Settings → Simulation)."}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {loads.map((l) => {
          const share = l.capacity > 0 ? l.hours / l.capacity : 0;
          const tone = l.status === "over" ? "bg-crit" : l.status === "overtime" ? "bg-warn" : "bg-fg-3/50";
          return (
            <li
              key={l.personId}
              className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-3 sm:grid-cols-[12rem_1fr_16rem]"
              aria-label={`${l.name}: ${formatNumber(l.hours)} of ${formatNumber(l.capacity)} hours a week from ${l.clients} clients, ${STATUS_LABEL[l.status]}`}
            >
              <span className="min-w-0 leading-tight">
                <span className="block truncate">{l.name}</span>
                <span className="block truncate text-xs text-fg-3">
                  {l.roleIds.map((r) => roleName.get(r)).join(", ")} · {l.clients} client{l.clients === 1 ? "" : "s"}
                </span>
              </span>
              <span className="relative h-4" aria-hidden>
                <span className="absolute inset-x-0 top-0.5 h-3 overflow-hidden rounded-sm bg-panel-2">
                  <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: width(share) }} />
                </span>
                {/* Ticks: a full week, and the week with the overtime cap. */}
                <span className="absolute inset-y-0 w-px bg-fg" style={{ left: width(1) }} />
                {cap > 0 && <span className="absolute inset-y-0 w-px bg-fg-3" style={{ left: width(1 + cap) }} />}
              </span>
              <span className="text-right text-xs tabular-nums sm:text-sm">
                {formatNumber(l.hours)} of {formatNumber(l.capacity, 0)} h/wk{" "}
                <span
                  className={`ml-1 rounded-token px-1.5 py-0.5 text-xs ${
                    l.status === "over" ? "bg-crit-soft text-crit" : l.status === "overtime" ? "bg-warn-soft" : "text-fg-3"
                  }`}
                >
                  {STATUS_LABEL[l.status]}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-3">
        Bar to 150% of the week · dark tick: 100%{cap > 0 ? ` · light tick: 100% + ${formatPercent(cap)} overtime` : ""}. The
        simulation recomputes these as clients are won and churn; its utilisation and overtime are on the process page.
      </p>
    </section>
  );
}

function AddClient({ data, backend }: { data: RosterData; backend: RosterBackend }) {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(async (_prev, form) => backend.create(form), {});
  const currency = data.workspace.settings.currency;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Name</span>
        <input name="name" required maxLength={200} className="rounded-token border border-line bg-panel px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">Service</span>
        <select name="service_id" className="rounded-token border border-line bg-panel px-2 py-1.5">
          <option value="">None yet</option>
          {data.services
            .filter((sv) => sv.active)
            .map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
        </select>
      </label>
      <label className="flex w-32 flex-col gap-1">
        <span className="text-xs font-medium text-fg-2">MRR ({currency})</span>
        <input
          name="mrr"
          type="number"
          inputMode="decimal"
          min={0}
          step={50}
          className="rounded-token border border-line bg-panel px-2 py-1.5 tabular-nums"
        />
      </label>
      <button type="submit" disabled={pending} className="rounded-token bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-60">
        {pending ? "Adding…" : "Add client"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

const TEMPLATE = (data: RosterData) =>
  ["Name", "Services", "Start date", "MRR", "Health", ...data.roles.slice(0, 2).map((r) => r.name), "Notes"].join(", ");

function PasteCsv({ data, backend }: { data: RosterData; backend: RosterBackend }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [result, setResult] = useState<{ error?: string; created?: number } | null>(null);
  const [pending, start] = useTransition();
  const ready = parsed?.rows.filter((r) => r.client) ?? [];
  const serviceName = new Map(data.services.map((s) => [s.id, s.name]));
  return (
    <details className="rounded-token border border-line px-3 py-2">
      <summary className="cursor-pointer font-medium">Paste clients from a spreadsheet or CSV</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-fg-3">
          First row: headers. Needs a Name column; Services (several separated by ;), Start date, MRR, Health, Notes,
          Active and a column per role (its person&apos;s name) are optional. Clients already on the roster are skipped.
          For example: <code className="font-mono">{TEMPLATE(data)}</code>
        </p>
        <textarea
          aria-label="Clients to paste"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setParsed(null);
            setResult(null);
          }}
          className="rounded-token border border-line bg-panel px-2 py-1.5 font-mono text-xs"
          placeholder={TEMPLATE(data)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setParsed(parseRosterCsv(text, data))}
            disabled={!text.trim()}
            className="rounded-token border border-line px-3 py-1 disabled:opacity-60"
          >
            Preview
          </button>
          {parsed && ready.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await backend.importClients(ready.map((row) => row.client!));
                  setResult(r);
                  if (!r.error) {
                    setText("");
                    setParsed(null);
                  }
                })
              }
              className="rounded-token bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-60"
            >
              {pending ? "Importing…" : `Import ${ready.length} client${ready.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
        {result?.error && (
          <p role="alert" className="text-crit">
            {result.error}
          </p>
        )}
        {result?.created !== undefined && <p role="status">Added {result.created} clients.</p>}
        {parsed && (
          <div className="flex flex-col gap-1 text-sm">
            {parsed.errors.map((e) => (
              <p key={e} role="alert" className="text-crit">
                {e}
              </p>
            ))}
            {parsed.ignoredColumns.length > 0 && <p className="text-fg-3">Ignored columns: {parsed.ignoredColumns.join(", ")}.</p>}
            {parsed.rows.length > 0 && (
              <table className="w-full text-left text-xs">
                <thead className="text-fg-3">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Line</th>
                    <th className="pr-2 font-medium">Client</th>
                    <th className="pr-2 font-medium">Services</th>
                    <th className="pr-2 text-right font-medium">MRR</th>
                    <th className="pr-2 font-medium">Assigned</th>
                    <th className="font-medium">Notes on the import</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parsed.rows.map((r) => (
                    <tr key={r.line} className={r.client ? "" : "text-fg-3 line-through"}>
                      <td className="py-1 pr-2 tabular-nums">{r.line}</td>
                      <td className="pr-2">{r.client?.name ?? "–"}</td>
                      <td className="pr-2">{r.client?.serviceIds.map((id) => serviceName.get(id)).join(", ")}</td>
                      <td className="pr-2 text-right tabular-nums">{r.client ? formatCurrency(r.client.mrr, data.workspace.settings.currency) : ""}</td>
                      <td className="pr-2 tabular-nums">{r.client ? Object.keys(r.client.assignments).length : ""}</td>
                      <td className={r.error ? "text-crit no-underline" : "text-fg-2"}>{[r.error, ...r.warnings].filter(Boolean).join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function healthTone(health: number | null) {
  const h = health ?? DEFAULT_HEALTH;
  return h < 50 ? "bg-crit-soft text-crit" : h < 70 ? "bg-warn-soft" : "bg-good-soft";
}

function ClientItem({ client: c, data, backend }: { client: ClientRow; data: RosterData; backend: RosterBackend }) {
  const disabled = !data.canEdit;
  const currency = data.workspace.settings.currency;
  const services = data.clientServices.filter((cs) => cs.client_id === c.id).map((cs) => cs.service_id);
  const assignments = new Map(data.clientAssignments.filter((a) => a.client_id === c.id).map((a) => [a.role_id, a.person_id]));
  const personName = new Map(data.people.map((p) => [p.id, p.name]));
  const serviceName = new Map(data.services.map((s) => [s.id, s.name]));
  const save =
    <T extends Scalar>(field: string): Saver<T> =>
    (base, next) =>
      backend.saveField(c.id, field, base, next) as Promise<SaveOutcome<T>>;
  const estimated = c.health === null || c.provenance?.health?.source === "estimated";
  // Roles with people, specialist roles first as they carry most of the client work.
  const roles = data.roles.filter((r) => data.personRoles.some((pr) => pr.role_id === r.id));
  const assignedText = roles
    .filter((r) => assignments.has(r.id))
    .map((r) => `${r.name}: ${personName.get(assignments.get(r.id)!) ?? "someone who left"}`)
    .join(" · ");
  return (
    <details className="group py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-token px-1 py-1 hover:bg-panel-2">
        <span aria-hidden className="text-fg-3 transition-transform group-open:rotate-90">
          ›
        </span>
        <span className={`font-semibold ${c.active ? "" : "text-fg-3 line-through"}`}>{c.name}</span>
        <span className="text-fg-2">{services.map((s) => serviceName.get(s)).join(" + ") || "No services"}</span>
        <span className="tabular-nums text-fg-2">{formatCurrency(Number(c.mrr), currency)}/month</span>
        <span
          className={`rounded-token px-1.5 text-xs tabular-nums ${healthTone(c.health === null ? null : Number(c.health))}`}
          title={estimated ? "Health: an estimate" : "Health: entered"}
        >
          Health {formatNumber(c.health === null ? DEFAULT_HEALTH : Number(c.health), 0)}
          {estimated ? " (est.)" : ""}
        </span>
        {!c.active && <span className="rounded-token bg-panel-2 px-1.5 text-xs text-fg-2">Inactive</span>}
        <span className="w-full truncate pl-5 text-xs text-fg-3 sm:w-auto sm:pl-0">{assignedText}</span>
      </summary>

      <div className="grid gap-4 px-1 pt-3 pb-2 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Name" value={c.name} save={save("name")} disabled={disabled} />
        <DateField label="Client since" value={c.start_date} save={save("start_date")} disabled={disabled} />
        <NumberField label="MRR" value={Number(c.mrr)} save={save("mrr")} unit={`${currency}/month`} min={0} step={50} disabled={disabled} />
        <NumberField
          label="Health"
          value={c.health === null ? null : Number(c.health)}
          save={save("health")}
          optional
          min={0}
          max={100}
          step={1}
          placeholder={`${DEFAULT_HEALTH} (estimated)`}
          disabled={disabled}
          hint="0–100. Blank: the simulation starts them at an estimated 80."
        />
        <ToggleField
          label="Status"
          value={c.active}
          save={save("active")}
          onLabel="Active"
          offLabel="Inactive: they left; not simulated"
          disabled={disabled}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <ChecklistField
            label="Services"
            value={services}
            save={(base, next) => backend.saveServices(c.id, base, next)}
            options={data.services.map((s) => ({ id: s.id, label: s.name, ...(s.active ? {} : { sublabel: "inactive" }) }))}
            emptyLabel="no services"
            disabled={disabled}
            hint="Their services' fallback load per role sets the client's ongoing hours."
          />
        </div>
        {roles.map((r) => (
          <SelectField
            key={r.id}
            label={r.name}
            value={assignments.get(r.id) ?? null}
            save={(base, next) => backend.saveAssignment(c.id, r.id, base, next)}
            options={data.people
              .filter((p) => p.active && data.personRoles.some((pr) => pr.person_id === p.id && pr.role_id === r.id))
              .map((p) => ({ value: p.id, label: p.name }))}
            noneLabel="Shared by the role"
            disabled={disabled}
          />
        ))}
        <div className="sm:col-span-2 lg:col-span-3">
          <TextField label="Notes" value={c.notes} save={save("notes")} optional multiline disabled={disabled} />
        </div>
        {!disabled && (
          <div className="sm:col-span-2 lg:col-span-3">
            <RemoveClient clientId={c.id} name={c.name} backend={backend} />
          </div>
        )}
      </div>
    </details>
  );
}

function RemoveClient({ clientId, name, backend }: { clientId: string; name: string; backend: RosterBackend }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-fg-3 underline hover:text-crit">
        Remove client
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Remove {name}? This can&apos;t be undone; if they left, mark them inactive to keep the record.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await backend.remove(clientId);
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
