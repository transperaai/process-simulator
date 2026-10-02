# Tidewater Digital: the extraction dry run

An invented SEO agency, used to prove the extraction skill (`.agents/skills/extract-process/SKILL.md`) works end to end before anyone runs it on real interviews. Everything here is fictional: the people, the numbers and the quotes. It is a different agency, process and set of numbers from the QA pack in `docs/extraction/qa`.

Process: **Monthly client report** (servicing, entity `report`), 40 hour week, so a working day is 8 h.

| File | What it is |
|---|---|
| `interview-1.txt` | Hana Iqbal, account manager, 2026-10-05. Builds the process. |
| `interview-2.txt` | Owen Hart, SEO specialist, 2026-10-07. A second interview on the same process. |
| `run-1.json`, `run-2.json` | The ordered tool calls a run of the skill makes on each interview, solved by hand. A string exactly equal to `$file:<name>` stands for that file's text, and `$<key>` for the source id a call saved with `"save"`. |
| `summary-1.md`, `summary-2.md` | The report the skill's summary format asks for, written from the responses the e2e test observed (ids are from one recorded run). |

## What it shows

Interview 1 (new process):
- A point value cited with a quote (Pull ranking data, "about an hour a client").
- A symmetric hedge kept as a triangular range (Write commentary, "two, three hours": 2 / 2.5 / 3, cited at the midpoint) and a cited `current_wip`.
- Reasoned assumptions for every number nobody stated, given as explicit values (a value left out is defaulted by the server, whatever reasoning comes with it).
- Queueing kept out of `wait_hours` ("sits in Callum's inbox a day or two").
- Routing with no app evidence: Send report's one in ten goes in its `notes`.
- A process-level promise (five working days) that belongs on the servicing link in Settings.
- Five suggestions: two people, two clients, one lead source.
- First principles from the same transcript: a cited truth (the five-day promise), two assumptions with tests (one quoted, one reasoned), a requirement with a named owner, a simplify idea, and the sections left empty because nobody said anything (deletes, root cause, measures). Each item carries a quote as `"<quote>" (<speaker>, <date>, <time>)` or begins `Assumed:`.
- No nesting, on purpose. Send report ("Export to PDF, email it, a quick note") and Owen's Technical check (errors, broken links, page speed) are lists of small actions with one stated time each, so they stay single steps: the case where the skill says not to nest. The skill's own worked example shows a group and a child process.

Interview 2 (`target`):
- Owen's self-correction cited as one number, which conflicts with Hana's and becomes a triangular 1 / 2 / 3 range plus a perception-gap issue.
- A new step (Technical check) between two existing ones, with the edges of both.
- A second conflict (Director review rework, 20% against 50%) and a leave suggestion; facts already pending are not suggested again.

## Workspace preconditions

`postgrest-extraction.test.ts` seeds these into a workspace of its own:
- Roles: Account manager, SEO specialist, Director.
- People: Hana Iqbal (Account manager), Owen Hart (SEO specialist), Priti Rao (SEO specialist, FTE 1), Callum Reid (Director).
- Services: SEO retainer, Content add-on.
- Client: Marlow Physio (SEO retainer, MRR 2500).
- Lead source: Referrals, 2 a week.

## Used by

- `packages/mcp/test/extraction-fixtures.test.ts` lints both runs against the transcripts with no database: every quote verbatim, from a listed speaker, on the line at its timestamp; every number cited or reasoned; symmetric ranges cite their midpoint; suggestions carry evidence in their own shape; every first-principles item holds a verbatim quote or says `Assumed:`; steps inside groups and child processes are checked like any other, and a group carries no numbers of its own.
- `packages/mcp/test/postgrest-extraction.test.ts` replays them through the MCP server against PostgREST and Postgres (skipped unless `POSTGREST_URL` is set; see the README's "MCP end-to-end suites"). Set `EXTRACTION_RESPONSES_FILE` to keep the observed responses.
