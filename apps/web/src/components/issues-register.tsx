"use client";

// The issues register (docs/PRD.md §4.1, screen 9; issue #17): audit findings
// logged by hand and the issues the latest run detected, in one list with
// filters. Detected issues are read-only and refresh on every run; tracking
// one stores it (`source: promoted`) so later runs show it once, as tracked.
// "Run the fix" applies the linked scenario (or the detection's suggested
// what-if) and opens the compare view.

import { useState, type FormEvent, type ReactNode } from "react";
import type { IssueRow, IssueSource, IssueStatus, ScenarioRow } from "@transpera-flow/db";
import { ISSUE_SEVERITIES, ISSUE_TYPES, type DetectedIssue, type IssueSeverity, type IssueType } from "@transpera-flow/engine";
import type { Saver } from "@/lib/fields/field-controller";
import {
  NO_FILTERS,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  entryView,
  filterEntries,
  fixFor,
  promoteInput,
  registerEntries,
  type FixRequest,
  type IssueFilters,
  type RegisterEntry,
} from "@/lib/issues/register";
import type { IssuesState } from "@/lib/issues/use-issues";
import { ISSUE_STATUSES, MAX_EVIDENCE, MAX_TITLE, type IssueField } from "@/lib/issues/validate";
import { SelectField, TextField, type SelectOption } from "./fields";

const NONE: ReadonlySet<string> = new Set();

export interface Named {
  id: string;
  name: string;
}

const SEVERITY_STRIPE: Record<IssueSeverity, string> = {
  critical: "before:bg-crit",
  serious: "before:bg-serious",
  warning: "before:bg-warn",
  info: "before:bg-accent",
};
const SEVERITY_CHIP: Record<IssueSeverity, string> = {
  critical: "border-crit bg-crit-soft",
  serious: "border-serious bg-crit-soft/60",
  warning: "border-warn bg-warn-soft",
  info: "border-line bg-panel-2",
};

const chip = "rounded-token border border-line px-1.5 py-px text-xs whitespace-nowrap";
const button = "rounded-token border border-line px-2 py-0.5 text-xs hover:bg-panel-2 disabled:opacity-50";
const primary = "rounded-token bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg disabled:opacity-50";
const input = "w-full rounded-token border border-line bg-panel px-2 py-1 text-sm";

const options = (list: readonly Named[]): SelectOption[] => list.map((x) => ({ value: x.id, label: x.name }));
const typeOptions = ISSUE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));
const severityOptions = ISSUE_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] }));
const statusOptions = ISSUE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

export function IssuesRegister({
  layout,
  state,
  detected,
  running,
  processId,
  processes,
  steps,
  people,
  scenarios,
  brokenScenarios = NONE,
  canEdit,
  stepFilter,
  onStepFilterChange,
  onRunFix,
}: {
  /** `rail`: narrow, beside the map; `page`: the full register screen. */
  layout: "rail" | "page";
  state: IssuesState;
  /** This run's detections; null until the first run finishes. */
  detected: DetectedIssue[] | null;
  running: boolean;
  /** The process the detections came from. */
  processId: string;
  processes: Named[];
  steps: Named[];
  people: Named[];
  scenarios: ScenarioRow[];
  /** Ids of saved scenarios that need attention: issues whose fix is one say so (issue #16). */
  brokenScenarios?: ReadonlySet<string>;
  canEdit: boolean;
  /** Show only issues on this step (from a badge on the map). */
  stepFilter: string;
  onStepFilterChange: (stepId: string) => void;
  onRunFix: (fix: Omit<FixRequest, "nonce">, entryId: string) => void;
}) {
  const [filters, setFilters] = useState<IssueFilters>(NO_FILTERS);
  const [logging, setLogging] = useState(false);
  const entries = registerEntries(state.issues, detected ?? []);
  const shown = filterEntries(entries, { ...filters, step: stepFilter }, processId);
  const active = entries.filter((e) => entryView(e).open);
  const count = (s: IssueSeverity) => active.filter((e) => entryView(e).severity === s).length;
  const names = {
    step: new Map(steps.map((s) => [s.id, s.name])),
    person: new Map(people.map((p) => [p.id, p.name])),
    process: new Map(processes.map((p) => [p.id, p.name])),
  };
  const set = <K extends keyof IssueFilters>(key: K, value: IssueFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const filterSelect = (label: string, key: keyof IssueFilters, opts: SelectOption[], all: string) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-fg-3">{label}</span>
      <select value={filters[key]} onChange={(e) => set(key, e.target.value as never)} className={input}>
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label="Issues register" className="flex min-w-0 flex-col gap-2" data-issues-register>
      <p className="text-xs text-fg-2" aria-live="polite">
        <strong className="text-fg">
          {active.length} open issue{active.length === 1 ? "" : "s"}
        </strong>
        {count("critical") ? ` · ${count("critical")} critical` : ""}
        {count("serious") ? ` · ${count("serious")} serious` : ""}.{" "}
        {detected === null || running ? "Checking the latest run…" : "Detected issues refresh on every run; tracked ones stay until you close them."}
      </p>

      <div className={`grid gap-1.5 ${layout === "page" ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2"}`}>
        {processes.length > 1 && filterSelect("Process", "process", options(processes), "All processes")}
        {filterSelect("Person", "person", options(people), "Anyone")}
        {filterSelect("Severity", "severity", severityOptions, "Any severity")}
        {filterSelect(
          "Source",
          "source",
          (["manual", "detected", "promoted"] as IssueSource[]).map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
          "Any source",
        )}
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-fg-3">Status</span>
          <select value={filters.status} onChange={(e) => set("status", e.target.value as IssueFilters["status"])} className={input}>
            <option value="active">Open and detected</option>
            <option value="">Any status</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {stepFilter && (
        <p className="flex items-center gap-2 text-xs">
          <span className={chip}>On {names.step.get(stepFilter) ?? "a removed step"}</span>
          <button type="button" className="underline" onClick={() => onStepFilterChange("")}>
            Show all steps
          </button>
        </p>
      )}

      {state.error && (
        <p role="alert" className="rounded-token border border-crit bg-crit-soft p-2 text-xs">
          {state.error}{" "}
          <button type="button" className="underline" onClick={state.dismissError}>
            Dismiss
          </button>
        </p>
      )}

      {canEdit &&
        (logging ? (
          <LogIssueForm
            steps={steps}
            people={people}
            scenarios={scenarios}
            processId={processId}
            defaultStep={stepFilter}
            busy={state.busy}
            onCancel={() => setLogging(false)}
            onSubmit={async (input) => {
              if (await state.create(input)) setLogging(false);
            }}
          />
        ) : (
          <button type="button" className={`${button} self-start`} onClick={() => setLogging(true)}>
            + Log an issue
          </button>
        ))}

      {shown.length === 0 ? (
        <p className="rounded-token border border-dashed border-line p-3 text-xs text-fg-2">
          {entries.length === 0
            ? detected === null
              ? "Running the simulation…"
              : "Nothing detected in this run, and nothing logged yet."
            : "No issues match these filters."}
        </p>
      ) : (
        <ul className={`flex flex-col gap-2 ${layout === "rail" ? "max-h-[40rem] overflow-y-auto pr-1" : ""}`}>
          {shown.map((e) => (
            <IssueItem
              key={entryView(e).id}
              entry={e}
              names={names}
              steps={steps}
              people={people}
              scenarios={scenarios}
              brokenScenarios={brokenScenarios}
              canEdit={canEdit}
              state={state}
              processId={processId}
              showProcess={processes.length > 1}
              onRunFix={onRunFix}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueItem({
  entry,
  names,
  steps,
  people,
  scenarios,
  brokenScenarios,
  canEdit,
  state,
  processId,
  showProcess,
  onRunFix,
}: {
  entry: RegisterEntry;
  names: { step: Map<string, string>; person: Map<string, string>; process: Map<string, string> };
  steps: Named[];
  people: Named[];
  scenarios: ScenarioRow[];
  brokenScenarios: ReadonlySet<string>;
  canEdit: boolean;
  state: IssuesState;
  processId: string;
  showProcess: boolean;
  onRunFix: (fix: Omit<FixRequest, "nonce">, entryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const v = entryView(entry);
  const fix = fixFor(entry, scenarios);
  // A fix that needs attention can't be run until it is re-pointed (issue #16).
  const fixBroken = Boolean(fix?.scenarioId && brokenScenarios.has(fix.scenarioId));
  const issue = entry.kind === "tracked" ? entry.issue : null;
  const meta: ReactNode[] = [
    <span key="source" className={`${chip} ${entry.kind === "detected" ? "border-accent" : ""}`}>
      {SOURCE_LABELS[v.source]}
    </span>,
    <span key="type" className={chip}>
      {TYPE_LABELS[v.type]}
    </span>,
    <span key="sev" className={`${chip} ${SEVERITY_CHIP[v.severity]}`}>
      {SEVERITY_LABELS[v.severity]}
    </span>,
  ];
  if (v.status) meta.push(<span key="status" className={chip}>{STATUS_LABELS[v.status]}</span>);
  if (issue?.detected_key) {
    meta.push(
      <span key="det" className={`${chip} ${entry.kind === "tracked" && entry.detection ? "" : "text-fg-3"}`}>
        {entry.kind === "tracked" && entry.detection ? "Still detected" : "No longer detected"}
      </span>,
    );
  }
  const where = [
    showProcess && v.processId ? names.process.get(v.processId) : null,
    v.stepId ? names.step.get(v.stepId) ?? "a removed step" : null,
    v.personId ? names.person.get(v.personId) : null,
    issue?.owner_person_id ? `owner ${names.person.get(issue.owner_person_id) ?? "someone who left"}` : null,
  ].filter(Boolean);

  return (
    <li
      data-issue={v.id}
      data-source={v.source}
      className={`relative rounded-token border border-line bg-panel py-2 pr-2 pl-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l-token ${SEVERITY_STRIPE[v.severity]}`}
    >
      <p className="text-sm font-semibold">{v.title}</p>
      {v.evidence && <p className="mt-0.5 text-xs text-fg-2">{v.evidence}</p>}
      {where.length > 0 && <p className="mt-0.5 text-xs text-fg-3">{where.join(" · ")}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {meta}
        <span className="ml-auto flex flex-wrap gap-1">
          {entry.kind === "detected" && canEdit && (
            <button
              type="button"
              className={button}
              disabled={state.busy}
              onClick={() => void state.promote(promoteInput(entry.detection, processId, scenarios))}
              title="Keep this in the register with an owner and status; later runs will show it once, as tracked."
            >
              Track
            </button>
          )}
          {issue && canEdit && (
            <button type="button" className={button} aria-expanded={editing} onClick={() => setEditing((x) => !x)}>
              {editing ? "Done editing" : "Edit"}
            </button>
          )}
          {fix && !fixBroken && v.type !== "broken_scenario" && (
            <button type="button" className={primary} onClick={() => onRunFix(fix, v.id)} title={`Apply “${fix.name}” and compare it with the baseline`}>
              Run the fix →
            </button>
          )}
        </span>
      </div>
      {v.type === "broken_scenario" ? (
        <p className="mt-1 text-xs text-fg-3">Re-point its changes under Scenarios; this issue resolves itself once the scenario applies again.</p>
      ) : fixBroken ? (
        <p className="mt-1 text-xs text-crit" data-fix-broken>
          Fix: {fix!.name} needs attention (a change in it no longer resolves), so it can&apos;t be run until it is re-pointed under Scenarios.
        </p>
      ) : (
        fix && <p className="mt-1 text-xs text-fg-3">Fix: {fix.name}</p>
      )}
      {issue && editing && canEdit && (
        <div className="mt-2 grid gap-2 border-t border-line pt-2">
          <IssueFields issue={issue} steps={steps} people={people} scenarios={scenarios} state={state} />
          {confirming ? (
            <p className="flex items-center gap-2 text-xs">
              Delete this issue?
              <button
                type="button"
                className={`${button} border-crit`}
                disabled={state.busy}
                onClick={() => void state.remove(issue.id)}
              >
                Delete
              </button>
              <button type="button" className={button} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </p>
          ) : (
            <button type="button" className={`${button} self-start`} onClick={() => setConfirming(true)}>
              Delete issue
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Every field of a tracked issue, each saved on its own (per-field saves). */
function IssueFields({
  issue,
  steps,
  people,
  scenarios,
  state,
}: {
  issue: IssueRow;
  steps: Named[];
  people: Named[];
  scenarios: ScenarioRow[];
  state: IssuesState;
}) {
  const save = (field: IssueField) => state.saver(issue.id, field) as Saver<string | null>;
  return (
    <>
      <TextField label="Title" value={issue.title} save={save("title")} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Status" value={issue.status} save={save("status")} options={statusOptions} />
        <SelectField label="Severity" value={issue.severity} save={save("severity")} options={severityOptions} />
        <SelectField label="Type" value={issue.type} save={save("type")} options={typeOptions} />
        <SelectField label="Owner" value={issue.owner_person_id} save={save("owner_person_id")} options={options(people)} noneLabel="No owner" />
        <SelectField label="Step" value={issue.step_id} save={save("step_id")} options={options(steps)} noneLabel="No step" />
        <SelectField label="Person" value={issue.person_id} save={save("person_id")} options={options(people)} noneLabel="Nobody" />
      </div>
      <SelectField
        label="Fix (scenario)"
        value={issue.scenario_id}
        save={save("scenario_id")}
        options={options(scenarios)}
        noneLabel="No linked scenario"
        hint={issue.detected_key ? "Without one, “Run the fix” uses the detection's suggestion." : undefined}
      />
      <TextField label="Evidence" value={issue.evidence} save={save("evidence")} optional multiline />
    </>
  );
}

function LogIssueForm({
  steps,
  people,
  scenarios,
  processId,
  defaultStep,
  busy,
  onCancel,
  onSubmit,
}: {
  steps: Named[];
  people: Named[];
  scenarios: ScenarioRow[];
  processId: string;
  defaultStep: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: Parameters<IssuesState["create"]>[0]) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const title = get("title").trim();
    if (!title) return setError("Give the issue a title.");
    setError(null);
    void onSubmit({
      title,
      type: get("type") as IssueType,
      severity: get("severity") as IssueSeverity,
      status: "open" as IssueStatus,
      evidence: get("evidence").trim() || null,
      process_id: processId,
      step_id: get("step_id") || null,
      role_id: null,
      person_id: get("person_id") || null,
      owner_person_id: get("owner_person_id") || null,
      scenario_id: get("scenario_id") || null,
    });
  };
  const select = (name: string, label: string, opts: SelectOption[], none?: string, value?: string) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium text-fg-2">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={input}>
        {none !== undefined && <option value="">{none}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form onSubmit={submit} aria-label="Log an issue" className="grid gap-2 rounded-token border border-line bg-panel-2 p-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-fg-2">Title</span>
        <input name="title" required maxLength={MAX_TITLE} className={input} placeholder="What's wrong, in a sentence" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {select("type", "Type", typeOptions, undefined, "manual")}
        {select("severity", "Severity", severityOptions, undefined, "warning")}
        {select("step_id", "Step", options(steps), "No step", defaultStep)}
        {select("person_id", "Person", options(people), "Nobody")}
        {select("owner_person_id", "Owner", options(people), "No owner")}
        {select("scenario_id", "Fix (scenario)", options(scenarios), "None yet")}
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-fg-2">Evidence</span>
        <textarea name="evidence" rows={2} maxLength={MAX_EVIDENCE} className={input} placeholder="What you saw or heard, and where" />
      </label>
      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>
          Log issue
        </button>
        <button type="button" className={button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
