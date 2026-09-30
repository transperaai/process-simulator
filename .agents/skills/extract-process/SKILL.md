---
name: extract-process
description: Turn audit interview transcripts into a Transpera Flow draft process, with cited evidence, reasoned assumptions, conflicts and company-model suggestions, through the Transpera Flow MCP server.
disable-model-invocation: true
---

# Extract a process from interview transcripts

The goal is a **draft** the consultant (Austin) can correct and publish in under an hour. Every number in it is **cited** (a verbatim quote from a source) or **assumed** (with your reasoning). Company facts go in as **suggestions**. Your work ends at a draft and pending suggestions: the consultant publishes from the canvas, so `publish_process` and `discard_draft` stay untouched.

Leading words, used throughout: **cited**, **assumed**, **ledger** (one line per number heard), **conflict** (speakers disagree), **suggestion**, **draft**, **open question** (something the consultant must ask or decide).

## Steps

1. **Orient.**
   - Call `list_workspaces`, then `set_active_workspace {workspace}`. If more than one workspace fits, ask.
   - Call `get_workspace_summary`. Note the hours per working day (`workspace.settings.hours_per_week / 5`), the role names, the people and the processes.
   - Decide new process or `target`: does an existing process describe the same work? If unsure, ask.
   - For a target, call `get_process {process, revision}` with `"draft"` if it has a draft revision, otherwise `"live"`. Keep its step names and ids.
   - Call `list_suggestions {status: "pending"}`.
   - Done when you know the workspace, the hours per day, the roles you may use, new versus target, and the pending suggestions.
2. **Add sources.**
   - One `add_source` per transcript: `{title: "<Company> interview: <Name>, <role> (<date>)", kind: "transcript", speakers: [every speaker label exactly as written, interviewer included], recorded_at: "YYYY-MM-DD", body: <the full unedited text>}`.
   - Keep `data.source.id`. Add each transcript once per conversation and reuse ids you already hold.
   - Done when every transcript has an id.
3. **Build the ledger.** No tool calls in this step.
   - Read every transcript end to end.
   - Write one ledger line for every number or quantity said, vague ones included: speaker, timestamp, quote, the number in field units, destination.
   - Destinations: step field (cited), routing probability, suggestion, timing note, open question, or not modelled (with the reason).
   - Then draft the step list from "Mapping statements to fields".
   - Done when every number in every transcript has a ledger line.
4. **Import.**
   - Call `import_process` once per interview.
   - New process: `{process_json: {name, kind, entity_name, description, steps, edges}}`.
   - Second interview: `{target: <process id>, process_json: {steps, edges}}` (see "Second interview").
   - `ok: false` means nothing was written: fix the input (`error.candidates` lists the options for an ambiguous name) and send again.
   - `ok: true` is final: a re-sent import appends the same citations a second time, so corrections go through `update_step`.
   - Done when `ok: true`.
5. **Check the draft.**
   - Read `warnings`, `checklist`, `conflicts`, `not_overwritten` and the response's `assumptions`.
   - Fix branch sums or "Nothing leaves this step yet" with `set_routing {step, routes: [{to, probability}]}` (routes sum to 1) or `connect_steps`.
   - For any checklist assumption with no evidence whose `reasoning` starts "Server default for a" or "Given without a cited source", call `update_step {process, step, <field>: <the value you mean>, assumptions: [{field, reasoning}]}`. Reasoning alone keeps the default number.
   - Optional: when an interviewee stated an end-to-end time, call `run_scenario {process, revision: "draft"}` and put `kpi.cycle.mean` (working hours) beside the stated time in the timing notes. A servicing process alone returns `invalid_model` (it runs beside a pipeline): note that and move on.
   - Done when `warnings` is empty and every assumption carries your reasoning.
6. **Submit suggestions** (see "Suggestions"). Done when every ledger line marked suggestion has a stored suggestion or an open question that explains why not.
7. **Report** (see "Summary"). Done when the summary has every section, the empty ones included.

## Mapping statements to fields

| Heard | Field |
|---|---|
| A piece of work someone does | a `task` step with `role`: an existing role name, matched by meaning ("AM" is "Account manager"); if none fits, `null`, an `upsert_role` suggestion for the role (see "Suggestions"), and an open question to set the step's role once it is accepted |
| "Only X does it" | `person` |
| Software named | `tool` |
| Hands-on time per item | `work_hours` |
| Waiting on the client, an outside party or the calendar | `wait_hours` on the step before the wait, or a `wait` step if it stands alone |
| "Sits in X's inbox because they're busy" | queueing, which the engine simulates: a timing note, never `wait_hours` |
| "Comes back for changes N%" | `rework_rate` (0 to 1) plus `rework_to` (a step name; `null` repeats the step) |
| "I've got N on my desk now" | `current_wip` (integer) |
| A promise for this step | `sla_hours` (time at the step: queue plus work plus wait) |
| A choice point | a `decision` step plus edges with `probability` |
| The end | `end` steps with `outcome`: `won` or `lost` for a pipeline, `done` for servicing |

Structure:
- Exactly one `start` step.
- `kind` is `pipeline` when items arrive from demand and end won or lost, `servicing` for recurring client work. `entity_name` is what flows (lead, report).
- Leave out `x` and `y`: the server lays steps out.
- Step names are short verb phrases, unique within the process.
- Every non-end step has outgoing edges that sum to 1.
- A step can only name a role that exists. A missing role becomes an `upsert_role` suggestion, and the step's `role` stays `null` until someone accepts it. A role, person or client that is only a pending suggestion cannot be referenced yet.

Limits: `steps` 200, `edges` 500, per step `evidence` 50, `assumptions` 10 (`{field, reasoning}`, reasoning 1 to 2000 characters), `notes` 4000, `tool` 200, name 1 to 200.

## Units

- Everything is hours per item.
- A working day is `hours_per_week / 5` and a week is `hours_per_week`, both from the workspace settings; the engine counts five working days. Use the workspace's figure and never assume 8.
- Minutes divide by 60. "One in five" is 0.2.
- Round to at most 2 decimals.
- A citation's `value` is in the field's units even though the `quote` keeps the speaker's words.

## Cited numbers

Give the field value and a citation `{field, source, speaker, quote, timestamp, value}` inside the step's `evidence`. `field` is one of `work_hours`, `wait_hours`, `rework_rate`, `current_wip`, `sla_hours`; `source` is the source id or its title.

- The quote is the shortest verbatim span that states the number, copied character for character from one contiguous stretch of the transcript, so no ellipses and no stitched lines.
- The timestamp is the transcript's `[hh:mm:ss]` time without the brackets.
- The speaker is the label exactly as it appears in the transcript.
- When the interviewer proposes a number and the interviewee agrees, quote the exchange verbatim with the interviewee as speaker.
- When a speaker corrects themselves, cite only the correction and say so in the step's `notes`.
- Hedges:
  - Symmetric ("two, three hours", "a day or two"): `work_dist: "triangular"` with `work_params {min, mode, max}` (for a wait, `wait_dist` and `wait_params`) where `mode` is the midpoint, and cite `value` equal to that midpoint. The mean equals the midpoint, so the range survives and can still conflict with another speaker. A cited `value` that differs from the current mean turns a range back into a plain value.
  - Typical plus tail ("usually an hour, sometimes a half-day"): the field and `value` are the typical figure; the tail goes in `notes`.
  - A hedge on `rework_rate` or `current_wip`: the midpoint is the value (rounded to a whole number for `current_wip`), the hedge goes in `notes`.

## Assumed numbers

- Every value no source states is given explicitly, with a step-level `assumptions: [{field, reasoning}]` entry. The reasoning says why this number: an analogy to a cited step, what the speaker implied, or typical practice, naming the ledger evidence where there is some.
- Task steps always cover `work_hours`, `wait_hours` and `rework_rate`, by citation or by value plus reasoning (a zero is a value). Wait steps cover `wait_hours`. A field left out is filled by the server default whatever reasoning accompanies it, and that default is a number nobody chose.
- `sla_hours` and `current_wip` appear only when stated.

## Disagreements and conflicts

- When different speakers give different numbers for the same field, cite each speaker with their `value`. The server keeps each speaker's latest value per source, builds the triangular range (minimum, median, maximum) and marks the step `conflict: true`. It logs a perception-gap issue itself when the largest value is at least twice the smallest, so leave `log_issue` alone and leave averaging to the server.
- For a new step, leave the field value out and give only the citations. The server writes the range.
- Routing has no evidence in the app, so a routing disagreement cannot become an app conflict. Set the probability to the median of what was said, put every quote in the from-step's `notes`, and list it under "Routing conflicts (not tracked by the app)" in the summary.
- Company-fact disagreements: suggest nothing. List both quotes as an open question.

## Second interview on the same process

- Pass `target` as the process id (or exact name).
- List only the steps this interview says something about, plus new steps, using the exact existing step names from `get_process` (or `id`).
- For an existing step, send only the new speaker's citations (with `value`) and leave the field value out, so earlier and new evidence combine. The first interview's citations stay where they are.
- `notes` replaces the step's whole notes. To add a quote (a routing disagreement, a correction), send the existing notes from `get_process` with the new text appended.
- A new step between A and B: list edges `A to New` and `New to B`. Listing edges from A replaces all of A's outgoing edges, so include every branch A keeps, each with its probability.
- `remove_missing` stays at its default. A step someone says no longer happens is an open question.
- Report `created: false`, `diff.text`, `matched`, `conflicts` and `not_overwritten`. A value someone confirmed or entered on the canvas is kept: a disagreeing citation makes it a conflict in `conflicts` (no range is built), and `not_overwritten` lists only values or ranges you sent.

## Suggestions

Company facts are stored as suggestions that change nothing until a person accepts them on the Suggestions page.

- `upsert_role {name, create?, rename?, evidence?, note?}`: when a speaker names or clearly describes a job no existing role covers (matched by meaning). The evidence is the quote naming who does the work.
- `upsert_person {name, roles?, fte? (above 0, up to 1.5), capacity_hours_week?, cost_rate?, start_date?, end_date?, active?, leave?: [{start_date, end_date, note?}], create?, rename?, evidence?, note?}`. `roles` is the full set, by existing role name.
- `upsert_client {name, services?, mrr?, start_date?, health? (0 to 100), notes?, active?, assignments?: {role: person or null}, create?, rename?, evidence?, note?}`. `services` is the full set, by existing service name.
- `set_demand {lead_sources?: [{name, volume_week?, conversion_to_qualified?, create?, rename?, evidence?, note?}], seasonality?: 12 numbers or [{month, multiplier}], growth_monthly?, evidence?, note?}`.
- `set_company` and `upsert_service` apply only when a company setting or a service fact is stated.

Rules:
- Suggest only facts someone stated. Company-model numbers are never assumed.
- Suggestion evidence has a different shape from a step citation: `{source_id, speaker?, quote, timestamp?, value?}`. `source_id` is the source's uuid (a title is refused), there is no `field`, `speaker` is left out when unknown (never null), `timestamp` is at most 50 characters, and a call takes at most 20 citations.
- Every suggestion carries `evidence` and a `note` giving your reading.
- Plans and targets ("we want to grow 20%") are open questions.
- A future-dated change (an FTE change "from November") is a suggestion whose `note` says the date, and the same point is an open question.
- On `ambiguous`, pick from `candidates` when the transcript clearly means one of them. Pass `create: true` only when the row is clearly new; otherwise it is an open question.
- If a matching pending suggestion already exists (from `list_suggestions`), do not create another: say which one to edit or reject.
- `assignments` and `roles` must name existing rows. A pending new person or role cannot be referenced yet: suggest it, and list the assignment as an open question for after it is accepted.
- Never invent a role to fill a step; suggest only roles a speaker named or described.
- `get_workspace_summary` lists roles (with `active`) but no clients, services or lead sources. `upsert_*` without `create` matches by name: an exact match updates, a partial match returns `ambiguous` with candidates, and a name that matches nothing becomes a suggestion to add a new row. Send only names you mean to update or add.

## Summary (the final message)

Headings, in this order:

- `## Draft: <process>`: new, or the diff against live, with `diff.text` and the canvas path `/w/<slug>/p/<process id>`.
- `### Conflicts`: step, field, who said what, the range used. Then the routing conflicts.
- `### Assumptions`: step, field, value, reasoning.
- `### Not overwritten`: values someone entered that were kept.
- `### Suggestions`: each `headline`, with who said it.
- `### Open questions`: for the consultant to ask or decide.
- `### Timing notes`: queue remarks, process-level promises (a servicing SLA is set under Settings, Services, not on a step), stated versus simulated cycle times.
- `### Ledger`: a table covering every number heard.

## Worked example

An invented "Example Co" (roles Account manager and Copywriter exist; 40-hour week). The transcript says at `[00:03:10]` Sam: "the brief takes me two to four hours" and at `[00:05:42]` Sam: "sending it is half an hour, and about one in five ask for changes".

```json
{"process_json": {"name": "Client brief", "kind": "servicing", "entity_name": "brief",
 "steps": [
  {"name": "Start", "kind": "start"},
  {"name": "Draft brief", "role": "Copywriter", "work_dist": "triangular", "work_params": {"min": 2, "mode": 3, "max": 4}, "wait_hours": 0, "rework_rate": 0,
   "evidence": [{"field": "work_hours", "source": "<source id>", "speaker": "Sam", "quote": "the brief takes me two to four hours", "timestamp": "00:03:10", "value": 3}],
   "assumptions": [
    {"field": "wait_hours", "reasoning": "Sam names no wait after drafting; 0 because the brief goes straight to sending."},
    {"field": "rework_rate", "reasoning": "Nobody said the draft comes back; 0 until a second speaker says otherwise."}]},
  {"name": "Send brief", "role": "Account manager", "work_hours": 0.5, "wait_hours": 0, "rework_rate": 0,
   "notes": "Routing: Sam said 'about one in five ask for changes', so 0.2 goes back to Draft brief. The app keeps no evidence on routing.",
   "evidence": [
    {"field": "work_hours", "source": "<source id>", "speaker": "Sam", "quote": "sending it is half an hour", "timestamp": "00:05:42", "value": 0.5}],
   "assumptions": [
    {"field": "wait_hours", "reasoning": "Sending is immediate once the brief is ready; 0."},
    {"field": "rework_rate", "reasoning": "Changes are modelled as routing back to Draft brief, so the step's own rework is 0."}]},
  {"name": "Brief sent", "kind": "end", "outcome": "done"}],
 "edges": [{"from": "Start", "to": "Draft brief"}, {"from": "Draft brief", "to": "Send brief"},
  {"from": "Send brief", "to": "Brief sent", "probability": 0.8}, {"from": "Send brief", "to": "Draft brief", "probability": 0.2}]}}
```

One suggestion from the same interview, where Sam also said "Northgate Foods pay us three grand a month now":

```json
{"name": "Northgate Foods", "mrr": 3000, "note": "Sam gives the current retainer as 3000 a month.",
 "evidence": [{"source_id": "<source uuid>", "speaker": "Sam", "quote": "Northgate Foods pay us three grand a month now", "timestamp": "00:09:30", "value": 3000}]}
```

(sent as `upsert_client`'s arguments).
