# Redesign plan: Milestone A redesign wave, and Milestones B and C rewritten

Draft for Austin's approval, 1 Oct 2026. Nothing here is ticketed or built yet.

It comes from four things:

- Austin's Milestone A QA notes (30 Sep).
- The clickable prototype, `apps/web/prototype/app-flow.html`, published at
  https://claude.ai/artifact/KqK4DAsAYLk4EnzbBGvLjr.
- The agreed analysis rules in `docs/analysis-rules.md`.
- The first-principles research in `docs/research/first-principles.md`.

The prototype is the reference for every screen below. Each ticket names the prototype screen it builds.

## Where it lives

The redesign goes into **Milestone A** (#1) as tickets **A31–A58**. Audits need it: the current screens are what Austin
found confusing. B and C start only after it, on the rewritten tickets at the end of this document.

## How we build it

As before:

- Plan with Opus, build with Sonnet, review the larger tickets with Opus.
- Commit and push after every step.
- Apply additive migrations to production as we go and log them.
- Ask Austin before anything destructive.

Waves run in order. Tickets inside a wave can run in parallel unless one says it's blocked by another.

Two rules apply to every UI ticket:

1. Every setting, lever and rule has an **(i)** with a plain-English description and an example, written so anyone can
   understand it.
2. Screens use plain words, as in the prototype. Examples: "Too busy" not "utilisation", "Missed deadlines" not "SLA
   missed".

---

## Wave 0: Decisions and removals

| # | Ticket | What | Size |
|---|---|---|---|
| A31 | **Record the redesign** | <ul><li>Add the decisions from 30 Sep–1 Oct to the PRD decision log, as D21 onwards.</li><li>Rewrite PRD §3 core concepts and §8 screens to match.</li><li>Start `CONTEXT.md` with the new terms: insight, issue, solution, AI idea, block, first principles, rating, client group, churn driver, market condition.</li><li>Strike removed features from `docs/qa/milestone-a.md`.</li></ul> | S |
| A32 | **Remove what's going** | <ul><li>Remove **Reports**: pages, PDF route, print stylesheet, the `export_report` MCP tool, the report target in narration and the nav item. Keep "Explain this run". Leave the `reports` tables in place, unused.</li><li>Remove the **Clients** page, the **Scenarios** nav item, the **Runs** page, and the **Track** and **Run fix** buttons. Each is replaced by a later ticket.</li><li>Remove the demo report routes.</li></ul> | M |

## Wave 1: Shell, map and navigation

| # | Ticket | What | Prototype | Blocked by | Size |
|---|---|---|---|---|---|
| A33 | **App shell v2** | <ul><li>New sidebar: Overview, Processes / Improve: Issues, Solutions, Block library, Suggestions / Company: Sources, People, Settings. Icons and counts.</li><li>Restyle the remaining pages. Folds in #93 PR 2, so #93 closes with this.</li><li>Build the reusable (i) help component.</li></ul> | sidebar | A32 | M |
| A34 | **Map v2** | <ul><li>Bigger, readable nodes coloured by rating.</li><li>Zoom: −, Fit, +. Small maps fit the panel; big ones scroll instead of shrinking below 70%.</li><li>Expand and collapse groups, and Expand all.</li><li>Red badges only for confirmed issues.</li><li>Highlight and outline the steps an insight or issue touches.</li></ul> | every map | A33 | L |
| A35 | **Overview page** | <ul><li>Becomes the landing page.</li><li>Company map, 4 headline cards, and a time-horizon picker for 1/3/6/12/24 months.</li><li>"What the analysis found" with the AI read, then trend charts.</li></ul> | Overview | A34 | M |
| A36 | **Processes page and switcher** | <ul><li>A list of all processes with sub-processes indented. Each row opens its own map card.</li><li>Process switcher on the title, plus breadcrumbs.</li></ul> | Processes | A34, A37 | S |

## Wave 2: Process hierarchy, review page, editor and history

| # | Ticket | What | Prototype | Blocked by | Size |
|---|---|---|---|---|---|
| A37 | **Processes inside processes** | <ul><li>A step can hold its own steps: a group, or a child process. The company map is the root.</li><li>The engine always simulates the detailed steps, so numbers are the same expanded or collapsed.</li><li>Migration, plus MCP `import_process` support for nested steps.</li><li>Replaces **B8** (#37).</li></ul> | map expand | — | L |
| A38 | **Process page v2 (review)** | <ul><li>Read-only, labelled "Viewing live · version N".</li><li>Sections in order: first principles card, projection, map, insights, issues, solutions, supporting charts.</li><li>No tabs and no drawers.</li></ul> | Process | A34, A37 | M |
| A39 | **Editor as its own screen** | <ul><li>Full-screen editing mode in a different colour, so you can always tell you're editing.</li><li>Step palette, inspector (today's Step tab) and draft vs live.</li><li>Simulate preview, then "Publish version N?" with a confirm.</li><li>Three modes: draft, solution, block.</li></ul> | Editor | A37 | L |
| A40 | **Process history** | <ul><li>A timeline of published versions with each one's headline numbers and charts.</li><li>View a version read-only, restore it as a new draft, or duplicate it as a new process.</li><li>Replaces the Runs page and **C3** (#42).</li></ul> | History | A39 | M |

## Wave 3: Analysis

| # | Ticket | What | Blocked by | Size |
|---|---|---|---|---|
| A41 | **Engine: rating model** | <ul><li>The four-level rating, rules with three cut-offs, and the two escalators (busy months, slowest step).</li><li>Overrides per role, person, step, service or process.</li><li>Rework judged from the simulation; per-step expected waits.</li><li>Migrate rules 1, 3, 4, 5, 6 and 7. `ENGINE_VERSION` bump and golden re-approval.</li></ul> | — | L |
| A42 | **Engine: new rules** | <ul><li>Spare time.</li><li>Absence test: an extra run with the person away; rated on work lost and weeks to catch up.</li><li>Work lost at a step, against a per-step benchmark.</li><li>Too slow overall, against a process target.</li><li>Goals met, which reads success measures from A54.</li><li>Step fields: expected wait, lost per day of waiting.</li></ul> | A41 | L |
| A43 | **Cost per month** | <ul><li>Loss value: what's still to come when it's lost, chance-weighted before signing, remaining tenure after, capped at 12 months.</li><li>The cost method for each rule.</li><li>Insights sorted by cost within each rating.</li><li>AUD as the default currency for new workspaces.</li></ul> | A41 | M |
| A44 | **Settings → Analysis rules** | <ul><li>Switch each rule on or off, edit cut-offs with a live preview, add overrides, and reset.</li><li>Money settings and defaults.</li><li>Stored per workspace. Changing a rule re-rates the last run without simulating again.</li></ul> | A41 | M |
| A45 | **Insights v2** | <ul><li>Rated rows with cost, the rule behind each one, and where it sits on the map (hover to highlight).</li><li>A detail pop-up.</li><li>Nothing reaches the map until it's acknowledged.</li></ul> | A34, A41 | M |
| A46 | **AI analysis** | <ul><li>An "AI read" summary, plus AI insights marked AI.</li><li>Numbers are validated against the run, the same way narration is.</li><li>Runs when a version is published and when market conditions change.</li><li>Settings switches.</li></ul> | A45, A54 | M |

## Wave 4: Issues, solutions, blocks and suggestions

| # | Ticket | What | Blocked by | Size |
|---|---|---|---|---|
| A47 | **Issues v2: data and acknowledge** | <ul><li>An issue links to a whole process or to one or more steps.</li><li>More than one owner.</li><li>A target: measure, now, goal.</li><li>Statuses: Open, Testing solutions, Resolved, Won't fix.</li><li>A history log.</li><li>The Acknowledge dialog.</li><li>Migrate existing tracked issues.</li></ul> | A45 | M |
| A48 | **Issues pages** | <ul><li>List with Open / Resolved / All and rating filters.</li><li>Issue page: where it sits, solutions tested, AI ideas and history.</li><li>Mark resolved (by a solution, by changing the process, or no longer a problem) and Reopen.</li></ul> | A47 | M |
| A49 | **Solutions as their own thing** | <ul><li>A solution is a copy of a process with changed steps, plus optional lever changes. A process can have many.</li><li>A solution can solve more than one issue, with an automatic verdict against each issue's target and the user's own verdict.</li><li>Build solution from an issue opens the Editor in solution mode.</li><li>Changes the PRD's one-draft-per-process rule (D18): drafts stay single, and solutions are separate copies.</li></ul> | A39, A47 | L |
| A50 | **Solution page and list** | <ul><li>Live and solution maps side by side, opening and closing together.</li><li>Measures, MRR chart, market stress test, verdicts per issue and notes.</li><li>The Solutions list.</li></ul> | A49, A57 | M |
| A51 | **Block library** | <ul><li>Save a group of steps as a block.</li><li>Insert a block, or replace a selection with one, in the Editor.</li><li>Blocks marked AI are a type of block.</li></ul> | A39 | M |
| A52 | **Suggestions v2** | <ul><li>AI solution ideas made from blocks: Build it, or Dismiss.</li><li>AI-proposed issues.</li><li>Extend the suggestions schema to cover issues and solutions, and add matching MCP tools.</li><li>Folds in the Proposals queue from B4.</li></ul> | A49, A51 | M |

## Wave 5: Evidence and first principles

| # | Ticket | What | Blocked by | Size |
|---|---|---|---|---|
| A53 | **Sources must link** | <ul><li>A source links to a process, step, insight, issue or solution.</li><li>"+ Link" everywhere those appear.</li><li>Unlinked sources are flagged.</li><li>Migrate today's step citations.</li></ul> | A47, A49 | M |
| A54 | **First principles flow** | <ul><li>The seven steps per process: the job, hard truths vs assumptions, requirements with named owners, delete, simplify → speed up → automate, root cause, goals.</li><li>AI checks beside each step.</li><li>A summary card on the process page.</li><li>MCP tool so Claude can fill it in from transcripts.</li></ul> | A38 | L |

## Wave 6: Company model

| # | Ticket | What | Blocked by | Size |
|---|---|---|---|---|
| A55 | **Client groups** | <ul><li>Clients counted per service: number of clients, fee, normal churn, typical stay, starting health.</li><li>The engine simulates unnamed clients from these numbers, so late work still drives churn.</li><li>Named-client tables stay in the database but are hidden.</li><li>People page shows the company's client health against a benchmark.</li></ul> | A41 | L |
| A56 | **Churn drivers** | <ul><li>Ten drivers, each with a weight and an on/off switch, plus your own.</li><li>The engine measures the drivers it can and reports each one's share of churn.</li><li>Feeds the client health and cause-of-leaving rules.</li></ul> | A55 | L |
| A57 | **Market conditions** | <ul><li>Presets (Boom, Stable, Soft, Downturn) and your own custom conditions.</li><li>Seven factors.</li><li>A 24-month schedule the engine applies month by month.</li><li>Feeds the stress test on solution pages.</li></ul> | A41 | M |
| A58 | **Levers, settings help and 24-month horizon** | <ul><li>Settings → Levers: every lever, with show/hide and (i) help.</li><li>(i) help on every remaining setting.</li><li>Horizon picker up to 24 months, with a performance check against the PRD §6.7 targets.</li></ul> | A33, A57 | M |

Then Austin re-runs QA on the new screens. `docs/qa/milestone-a.md` is rewritten as each ticket lands. #27 (transcript
to draft) waits until A37 and A54, so the extraction skill can write nested processes and first principles.

---

## Milestone B: rewritten

| Ticket | Decision | Why |
|---|---|---|
| **B1** #30 All roles and visibility | **Keep, rewrite the spec** | Same roles. Visibility now covers the new pages; there are no per-client records. |
| **B2** #31 People and Clients views | **Rewrite as "People page"** | The Clients page is gone. People becomes its own page: how full each person's week is, absence-test results, and client health against the benchmark. |
| **B3** #32 View-only share links | **Keep, rewrite the spec** | Snapshots cover Overview, a process, an issue and a solution. Toggles become People and Financials; the Clients toggle is dropped. |
| **B4** #33 Play links and Proposals | **Rewrite** | A visitor's proposal arrives in Suggestions (A52), not a separate queue. |
| **B5** #34 Client branding | **Keep** | Unchanged. |
| **B6** #35 Forecast: forward run and alerts | **Rewrite** | The horizon picker and market schedule cover the forward run. What's left is "will someone become too busy, and when?" alerts as insights, and a monthly timeline chart. |
| **B7** #36 Forecast planning | **Rewrite, smaller** | Schedule a hire, leave or solution for a month on the timeline, and compare two plans. Keep the drag-and-drop if wanted (see question 3). |
| **B8** #37 Company map and sub-processes | **Close: moved to A37** | Done in the redesign. |
| **B9** #38 Issues kanban, filters, CSV | **Close the kanban; move CSV to B10** | Filters are in A48, and you haven't asked for a kanban. |
| **B10** #39 Map image export and JSON bundle | **Keep, add CSV export of issues** | Unchanged otherwise. |

## Milestone C: rewritten

| Ticket | Decision |
|---|---|
| **C1** #40 CSV import wizard | Keep. |
| **C2** #41 Calibration from historical data | Keep. Calibrated numbers also feed churn drivers and the market baseline. |
| **C3** #42 Version history and restore | Close: moved to A40. |
| **C4** #43 Storybook and visual regression | Keep. Best done once Austin's UI kit exists. |
| **C5** #44 Polish | Keep: dark mode, mobile view, onboarding, empty states, Sentry. |

## Questions for Austin

1. Is it right to put the redesign in **Milestone A** (A31–A58), rather than a separate milestone?
2. Named clients: is it right to **hide** them (data kept, nothing shown), not delete them?
3. **B7** forecast planning: keep the drag-and-drop timeline, or just a simple "schedule this for month N" form?
4. **B9** kanban: is it right to drop it?
5. Your UI kit: start the redesign on today's styles and switch to the kit later, or wait for it?
