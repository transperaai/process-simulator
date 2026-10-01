"use client";

// The issues register (docs/PRD.md §4.1, screen 9; issue #17): audit findings
// logged by hand and the issues the latest run detected, in one list with
// filters. Detected issues are read-only and refresh on every run; tracking
// one stores it (`source: promoted`) so later runs show it once, as tracked.

import { useState, type FormEvent, type ReactNode } from "react";
import type { IssueRow, IssueSource, IssueStatus, ScenarioRow } from "@transpera-flow/db";
import { ISSUE_TYPES, RATING_LABELS, STORED_SEVERITIES, ratingOfStored, type DetectedIssue, type IssueType, type Rating, type StoredSeverity } from "@transpera-flow/engine";
import type { Saver } from "@/lib/fields/field-controller";
import {
  NO_FILTERS,
  RATINGS_WORST_FIRST,
  SOURCE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  entryView,
  filterEntries,
  fixFor,
  formatIssueCost,
  registerEntries,
  type IssueFilters,
  type RegisterEntry,
} from "@/lib/issues/register";
import type { IssuesState } from "@/lib/issues/use-issues";
import { ISSUE_STATUSES, MAX_EVIDENCE, MAX_TITLE, type IssueField } from "@/lib/issues/validate";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SelectField, TextField, type SelectOption } from "./fields";
import { HelpLabel } from "./help";


/** Plain-English (i) text for the issue fields and filters, with an example (issue #123). */
const ISSUE_HELP = {
  title: { description: "A short sentence saying what is wrong.", example: "Proposals wait too long for review." },
  status: { description: "Where this issue is: new, being worked on, or dealt with.", example: "Open means someone still needs to look at it." },
  rating: { description: "How serious it is: Great, Good, Bad, or Operational risk (could break delivery or lose clients).", example: "Operational risk for a step only one person can do." },
  type: { description: "What kind of problem it is.", example: "Manual means you wrote it yourself; detected ones come from the simulation." },
  owner: { description: "The person who will sort it out.", example: "Maya, if she runs the strategist review." },
  step: { description: "The step of the process where the problem shows up.", example: "Audit & proposal." },
  person: { description: "The person it affects, if it is about one person.", example: "Maya Collins, when she is too busy." },
  fix: { description: "A saved scenario that tries a fix for this issue, so you can see if it helps.", example: "Hire a strategist." },
  evidence: { description: "What you saw or heard, and where, so others can trust it.", example: "Rosa said in the 3 Oct interview that reviews take 2 days." },
  process: { description: "Show only issues on one process.", example: "Lead to live." },
  source: { description: "Show only issues found one way: written by you, spotted by the simulation, or promoted from a spotted one.", example: "Detected shows what the simulation found." },
} as const;

const NONE: ReadonlySet<string> = new Set();

export interface Named {
  id: string;
  name: string;
}

const RATING_STRIPE: Record<Rating, string> = {
  risk: "before:bg-crit",
  bad: "before:bg-serious",
  good: "before:bg-warn",
  great: "before:bg-accent",
};
const RATING_CHIP: Record<Rating, string> = {
  risk: "border-crit bg-crit-soft",
  bad: "border-serious bg-crit-soft/60",
  good: "border-warn bg-warn-soft",
  great: "border-line bg-panel-2",
};

const chip = "rounded-full border border-border px-2 py-px text-xs whitespace-nowrap";
const button = buttonVariants({ variant: "outline", size: "xs" });
const primary = buttonVariants({ size: "xs" });

const options = (list: readonly Named[]): SelectOption[] => list.map((x) => ({ value: x.id, label: x.name }));
const typeOptions = ISSUE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));
// Filters pick a rating. Stored issues keep the database's four values, so the edit and log forms send those, labelled with the rating each stands for.
const ratingOptions = RATINGS_WORST_FIRST.map((r) => ({ value: r, label: RATING_LABELS[r] }));
const storedRatingOptions = STORED_SEVERITIES.map((s) => ({ value: s, label: RATING_LABELS[ratingOfStored(s)] }));
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
  currency,
  stepFilter,
  onStepFilterChange,
  onHighlight,
}: {
  /** The workspace currency, for each issue's cost per month. */
  currency: string;
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
  /** Hovering or focusing an issue (null when leaving it) names the step it sits on, so the map can highlight it (issue #99). */
  onHighlight?: (stepId: string | null) => void;
}) {
  const [filters, setFilters] = useState<IssueFilters>(NO_FILTERS);
  const [logging, setLogging] = useState(false);
  const entries = registerEntries(state.issues, detected ?? []);
  const shown = filterEntries(entries, { ...filters, step: stepFilter }, processId);
  const active = entries.filter((e) => entryView(e).open);
  const count = (r: Rating) => active.filter((e) => entryView(e).rating === r).length;
  const names = {
    step: new Map(steps.map((s) => [s.id, s.name])),
    person: new Map(people.map((p) => [p.id, p.name])),
    process: new Map(processes.map((p) => [p.id, p.name])),
  };
  const set = <K extends keyof IssueFilters>(key: K, value: IssueFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const filterSelect = (label: string, key: keyof IssueFilters, opts: SelectOption[], all: string) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <HelpLabel label={label} {...(key === "source" ? ISSUE_HELP.source : key === "process" ? ISSUE_HELP.process : key === "person" ? ISSUE_HELP.person : ISSUE_HELP.rating)} />
      <NativeSelect value={filters[key]} onChange={(e) => set(key, e.target.value as never)} className="h-7 text-sm md:text-sm">
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  return (
    <section aria-label="Issues register" className="flex min-w-0 flex-col gap-2" data-issues-register>
      <p className="text-xs text-fg-2" aria-live="polite">
        <strong className="text-fg">
          {active.length} open issue{active.length === 1 ? "" : "s"}
        </strong>
        {count("risk") ? ` · ${count("risk")} operational risk` : ""}
        {count("bad") ? ` · ${count("bad")} bad` : ""}.{" "}
        {detected === null || running ? "Checking the latest run…" : "Detected issues refresh on every run; tracked ones stay until you close them."}
      </p>

      <div className={`grid gap-1.5 ${layout === "page" ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2"}`}>
        {processes.length > 1 && filterSelect("Process", "process", options(processes), "All processes")}
        {filterSelect("Person", "person", options(people), "Anyone")}
        {filterSelect("Rating", "rating", ratingOptions, "Any rating")}
        {filterSelect(
          "Source",
          "source",
          (["manual", "detected", "promoted"] as IssueSource[]).map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
          "Any source",
        )}
        <label className="flex min-w-0 flex-col gap-0.5">
          <HelpLabel label="Status" {...ISSUE_HELP.status} />
          <NativeSelect value={filters.status} onChange={(e) => set("status", e.target.value as IssueFilters["status"])} className="h-7 text-sm md:text-sm">
            <option value="active">Open and detected</option>
            <option value="">Any status</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
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
        <p role="alert" className="rounded-lg border border-crit bg-crit-soft p-2 text-xs">
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
        <p className="rounded-lg border border-dashed border-line p-3 text-xs text-fg-2">
          {entries.length === 0
            ? detected === null
              ? "Running the simulation…"
              : "Nothing detected in this run, and nothing logged yet."
            : "No issues match these filters."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
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
              currency={currency}
              state={state}
              showProcess={processes.length > 1}
              onHighlight={onHighlight}
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
  currency,
  state,
  showProcess,
  onHighlight,
}: {
  currency: string;
  entry: RegisterEntry;
  names: { step: Map<string, string>; person: Map<string, string>; process: Map<string, string> };
  steps: Named[];
  people: Named[];
  scenarios: ScenarioRow[];
  brokenScenarios: ReadonlySet<string>;
  canEdit: boolean;
  state: IssuesState;
  showProcess: boolean;
  onHighlight?: (stepId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const v = entryView(entry);
  const fix = fixFor(entry, scenarios);
  // A fix that needs attention must be re-pointed (issue #16).
  const fixBroken = Boolean(fix?.scenarioId && brokenScenarios.has(fix.scenarioId));
  const issue = entry.kind === "tracked" ? entry.issue : null;
  const meta: ReactNode[] = [
    <span key="source" className={`${chip} ${entry.kind === "detected" ? "border-accent" : ""}`}>
      {SOURCE_LABELS[v.source]}
    </span>,
    <span key="type" className={chip}>
      {TYPE_LABELS[v.type]}
    </span>,
    <span key="sev" className={`${chip} ${RATING_CHIP[v.rating]}`}>
      {RATING_LABELS[v.rating]}
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
      onMouseEnter={onHighlight && v.stepId ? () => onHighlight(v.stepId) : undefined}
      onMouseLeave={onHighlight && v.stepId ? () => onHighlight(null) : undefined}
      onFocus={onHighlight && v.stepId ? () => onHighlight(v.stepId) : undefined}
      onBlur={onHighlight && v.stepId ? () => onHighlight(null) : undefined}
      className={`relative rounded-lg border border-line bg-panel py-2 pr-2 pl-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l-lg ${RATING_STRIPE[v.rating]}`}
    >
      <p className="text-sm font-semibold">{v.title}</p>
      {v.evidence && <p className="mt-0.5 text-xs text-fg-2">{v.evidence}</p>}
      {entry.kind === "detected" || entry.detection ? (
        <p className="mt-0.5 text-xs text-fg-2" data-cost title={v.cost?.method}>
          <span className="font-medium">{formatIssueCost(v.cost, currency)}</span>
          {v.cost?.method ? <span className="text-fg-3"> · {v.cost.method}</span> : null}
        </p>
      ) : null}
      {where.length > 0 && <p className="mt-0.5 text-xs text-fg-3">{where.join(" · ")}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {meta}
        <span className="ml-auto flex flex-wrap gap-1">
          {issue && canEdit && (
            <button type="button" className={button} aria-expanded={editing} onClick={() => setEditing((x) => !x)}>
              {editing ? "Done editing" : "Edit"}
            </button>
          )}
        </span>
      </div>
      {v.type === "broken_scenario" ? (
        <p className="mt-1 text-xs text-fg-3">Re-point its changes under Scenarios; this issue resolves itself once the scenario applies again.</p>
      ) : fixBroken ? (
        <p className="mt-1 text-xs text-crit" data-fix-broken>
          Fix: {fix!.name} needs attention (a change in it no longer resolves), so it needs re-pointing under Scenarios.
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
      <TextField label="Title" value={issue.title} save={save("title")} help={ISSUE_HELP.title} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Status" value={issue.status} save={save("status")} options={statusOptions} help={ISSUE_HELP.status} />
        <SelectField label="Rating" value={issue.severity} save={save("severity")} options={storedRatingOptions} help={ISSUE_HELP.rating} />
        <SelectField label="Type" value={issue.type} save={save("type")} options={typeOptions} help={ISSUE_HELP.type} />
        <SelectField label="Owner" value={issue.owner_person_id} save={save("owner_person_id")} options={options(people)} noneLabel="No owner" help={ISSUE_HELP.owner} />
        <SelectField label="Step" value={issue.step_id} save={save("step_id")} options={options(steps)} noneLabel="No step" help={ISSUE_HELP.step} />
        <SelectField label="Person" value={issue.person_id} save={save("person_id")} options={options(people)} noneLabel="Nobody" help={ISSUE_HELP.person} />
      </div>
      <SelectField
        label="Fix (scenario)"
        value={issue.scenario_id}
        save={save("scenario_id")}
        options={options(scenarios)}
        noneLabel="No linked scenario"
        help={ISSUE_HELP.fix}
              />
      <TextField label="Evidence" value={issue.evidence} save={save("evidence")} optional multiline help={ISSUE_HELP.evidence} />
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
      severity: get("severity") as StoredSeverity,
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
  const select = (name: string, label: string, opts: SelectOption[], help: { description: string; example: string }, none?: string, value?: string) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <HelpLabel label={label} {...help} />
      <NativeSelect name={name} defaultValue={value ?? ""}>
        {none !== undefined && <option value="">{none}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  return (
    <form onSubmit={submit} aria-label="Log an issue" className="grid gap-2 rounded-lg border border-line bg-panel-2 p-2">
      <label className="flex flex-col gap-0.5">
        <HelpLabel label="Title" {...ISSUE_HELP.title} />
        <Input name="title" required maxLength={MAX_TITLE} placeholder="What's wrong, in a sentence" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {select("type", "Type", typeOptions, ISSUE_HELP.type, undefined, "manual")}
        {select("severity", "Rating", storedRatingOptions, ISSUE_HELP.rating, undefined, "warning")}
        {select("step_id", "Step", options(steps), ISSUE_HELP.step, "No step", defaultStep)}
        {select("person_id", "Person", options(people), ISSUE_HELP.person, "Nobody")}
        {select("owner_person_id", "Owner", options(people), ISSUE_HELP.owner, "No owner")}
        {select("scenario_id", "Fix (scenario)", options(scenarios), ISSUE_HELP.fix, "None yet")}
      </div>
      <label className="flex flex-col gap-0.5">
        <HelpLabel label="Evidence" {...ISSUE_HELP.evidence} />
        <Textarea name="evidence" rows={2} maxLength={MAX_EVIDENCE} placeholder="What you saw or heard, and where" />
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
