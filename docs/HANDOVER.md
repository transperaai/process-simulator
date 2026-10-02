# Handover

Updated 1 Oct 2026 (late evening), during the redesign build (Milestone A, A31–A58). Start a new session with:

> Read `CLAUDE.md` and `docs/HANDOVER.md`, then carry on from "Next steps".

## Where things stand

**Redesign (Milestone A, #1):** Austin's QA turned into a redesign, validated with the HTML prototype
(`apps/web/prototype/app-flow.html`, live at https://claude.ai/artifact/KqK4DAsAYLk4EnzbBGvLjr) and planned in
`docs/plans/redesign-plan.md` (tickets A31–A58, #96–#123) and `docs/plans/build-plan.md` (rounds, guardrails).
Builders follow `docs/plans/builder-brief.md`. Progress comments go on #1.

Merged to `main` (live on https://transpera-flow.vercel.app):

| Ticket | PR | Notes |
|---|---|---|
| A31 record the redesign (#96) | #125 | PRD D21–D37, CONTEXT.md |
| A32 remove Reports, Clients, Runs, Scenarios nav (#97) | #126 | |
| A41 rating engine (#106) | #127 | ENGINE 1.1.0 |
| A33 app shell v2, (i) help (#98, closes #93) | #128 | |
| A44 Settings → Analysis rules (#109) | #131 | migration 20261104000000 |
| A57 market conditions (#122) | #130 | migration 20261105000000, ENGINE 1.2.0 |
| A37 processes inside processes (#102) | #129 | migration 20261108000000 |
| A42 new rules (#107) | #133 | migration 20261110000000, ENGINE 1.3.0 |
| A55 client groups (#120) | #134 | migration 20261111000000, ENGINE 1.4.0 |
| A34 map v2 (#99) | #136 | |
| A58 levers, help, 24-month horizon (#123) | #135 | migration 20261112000000 |
| A43 cost per month (#108) | #132 | migration 20261113000000, ENGINE 1.5.0 |
| A39 Editor as its own screen (#104) | #137 | `/p/<id>/edit` |
| A36 Processes page and switcher (#101) | #139 | |
| A35 Overview (#100) | #141 | `/w/<slug>` is the Overview; process pages moved to `/p/<id>` |
| A38 process page v2 (#103) | #142 | read-only review page; levers inline in Projection; no Save run |
| A56 churn drivers (#121) | #140 | migration 20261116000000, ENGINE 1.6.0 |
| A51 block library (#116) | #143 | migration 20261117000000 |
| A45 insights v2 (#110) | #145 | |
| A40 process history (#105) | #144 | migration 20261118000000 |
| Engine performance | #148 | recovers the A56 churn-tick cost; outputs bit-identical, ENGINE 1.6.0 |
| A54 first principles (#119) | #147 | migration 20261119000000 |
| A47 issues data and Acknowledge dialog (#112) | #149 | migration 20261120000000 (strictly additive; see below) |

Open PRs (each gets an Opus review; findings go back to the builder; I apply the migration, then merge):

| Ticket | PR | Migration | State |
|---|---|---|---|
| A46 AI analysis (#111) | #150 | 20261121000000 (row 33) | merged, applied |
| A49 solutions (#114) | not yet open | 20261122000000 (row 35) | building |
| A48 issues pages (#113) | #152 | 20261121500000 (row 34) | re-check passed; main (with A46) merged in; ready to apply and merge |

Next: A50 solution page (after A49), A52 suggestions (after A49 and A46), A53 sources must link (last).

**Production database:** applied up to `20261120000000`. Migrations go on strictly in version order, before the PR
merges (the app reads the new tables). A PR that slips is renumbered, not applied out of order. See
`docs/production-migrations.md`.

**Austin's decisions on 1 Oct:** Northbeam's client groups are two services (SEO, PPC), no third "SEO + PPC"
service; production numbers moving to client groups is fine ("it's an example, so clean it up"); the A41/A42 rule
choices are confirmed (`docs/analysis-rules.md`). In the evening: churn drivers keep only late work and market on
(no numbers move); dismissing an insight lasts until that process's next published version (built in A47); Save
run stays removed (History replaces it; "Explain this run" has no entry point until A46/A52 give it one).

**Issue statuses (A47):** the UI shows Open / Testing solutions / Resolved / Won't fix, stored as `open` /
`in_progress` / `done` / `done` + `resolution = 'wont_fix'` (mapping in `packages/db/src/issue-status.ts`). A later
"contract" migration that rewrites stored values and tightens the check needs Austin's go-ahead.

**Waiting on Austin:**
- **CI timing tests:** the PRD §6.7 tests (`scenarios.test.ts`, `servicing.test.ts`) use absolute limits that shared
  GitHub runners miss by 15–20% now and then, even after #148. Options: a separate perf job with one retry, or
  budgets relative to a baseline measured on the same runner. Tests have not been loosened.
- **AI analysis sources (A46):** "read linked sources and quotes" defaults off (it would send interview quotes to
  Anthropic). Switch on per workspace in Settings → AI analysis if wanted.
- **24-month speed:** a slider move on full Northbeam at 24 months takes about 360–440 ms, against the 250 ms
  13-week target (A58 tests against the target scaled by horizon).

**Follow-ups noted:** an exact per-month MRR series from the engine (A35's range covers new-client revenue only);
an MCP client-groups tool; rule 9 in settings; the horizon picker on more pages; block delete/rename; ~~the flaky
`map-browser.test.ts` "does not move the view when a highlight changes"~~ (fixed: the harness mounted a read-only map in a
bare flex row, so it shrink-wrapped to its toolbar and refit when the "drag the map" hint resized it; it now sits in a block,
as in the app).

## How we work

- **Austin approves waves; within a wave, carry on without waiting.** Tell him when each wave finishes and go
  straight to the next unless he says otherwise.
- **Delegate building to agents** to save the main session's context. Model policy (Austin's): plan with Opus,
  build with Sonnet, review larger tickets with Opus. Give routine work (merges, small fixes) to Sonnet or do it
  directly. Tell agents to **commit and push after every step**: a container restart once lost unpushed agent work.
- **Keep GitHub issues current:** comment on a ticket when work starts (name the branch), put `Closes #N` in the
  PR, and post a progress comment on the milestone parent issue after each wave.
- **Production migrations: apply as we go** (Austin approved this). Additive only; verify after each, and log
  it in `docs/production-migrations.md`. Anything destructive, or any other production-affecting action, needs
  Austin's go-ahead first.
- Austin would rather Claude runs commands than he does. Never paste API keys or tokens into chat.
- If the auto-mode classifier blocks an action, stop and ask Austin; never work around it.
- **Parked for later** (Austin): performance optimisation (see below), and refining the flow after his review.

## Operations

**Production SQL** (Supabase project `vgsjkpwvxkpqvyazwcyq`, via the Management API; allowed in
`.claude/settings.json`):

```sh
bash packages/db/scripts/prod-sql.sh -c "select 1"
bash packages/db/scripts/prod-sql.sh -f apply.sql
```

**Applying a migration:**
1. Before merging the PR, write an apply file:
   - `begin;`
   - the migration's SQL
   - `insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<name>', array[$mig$<the migration SQL>$mig$]);`
   - `commit;`
2. Run preflight queries for anything that could fail on real data.
3. Apply the file.
4. Verify: tables, row-level security, policies, and the `schema_migrations` row.
5. Merge the PR, then update the log.

- **Migration order:** migrations apply in file-name order. A migration landing after a later-numbered one
  must be renumbered.
- **`save_fields`:** each migration that redefines `save_fields` must copy the **latest** definition and
  append to its allow-list, because the last definition wins.

**CI:**
- The GitHub `check` job runs lint, typecheck, tests, the build, and the PostgREST end-to-end tests. Each PR
  also gets a Vercel preview.
- In the cloud container, use `gh api` REST calls; GraphQL is blocked.
- Merge with `gh api -X PUT repos/transperaai/transpera-flow/pulls/<n>/merge -f merge_method=squash`.

**Local tests in the cloud container** (Postgres 16 and Chromium are preinstalled):

```sh
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgtest/data -o '-p 5432 -k /tmp' -l /var/tmp/pgtest/log start"
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
export CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
pnpm lint && pnpm typecheck && pnpm test
```

If `/var/tmp/pgtest/data` doesn't exist after a container reset, run `initdb` there as `postgres` and set the
password to `postgres`.

**Secrets:**
- `SUPABASE_ACCESS_TOKEN` is set in the cloud environment.
- `ANTHROPIC_API_KEY` is set in Vercel (Production and Preview) for narration (#29). Without it, "explain this run" prints
  the templated text.

## Next steps

1. Drive the open PRs above to merged, in migration order.
2. Start the next round as blockers merge (see the table's last line), up to four builders at once.
3. After each merge: comment on the ticket, keep `docs/qa/milestone-a.md` current, update this file.
4. Morning summary for Austin: what's live, anything parked, the 24-month performance note.

The 30 Sep plan (QA list → triage → build) is done: the triage became the redesign plan.

## Decisions from Austin (30 Sep)

- **Google sign-in only** stays (the #4 ticket said magic link; the app has "Continue with Google").
- **Most real audits:** Austin will usually give Claude the process structure (nodes, often from a diagram) over MCP
  and fill in times and percentages on the canvas. Transcripts are one input, not the only one.
- **Scenarios should come from analysis, not a preset library.** Today every workspace is seeded with four generic
  scenarios (`private.scenario_library()`: hire into the busiest role, automate the heaviest step, more leads,
  downturn; `@busiest` / `@heaviest` resolve at run time) and Northbeam has two example ones. Austin's vision:
  simulate the current state, then derive options from the results (bottleneck, shadow price, queues, issues) and
  an **AI analysis mode** that reads a range of simulated factors (robustness sensitivities, narration facts) and
  proposes and tests changes, ranked with ranges. He wants to play with the current version first: **don't build
  until he decides**; it's a candidate Milestone B ticket.

## Open items for Austin's QA

- The lost-revenue definition, and the starter scenarios (see the decision above).
- Larkspur (the second sample workspace) is not seeded in production; it's only at `/demo/larkspur`.
- The /privacy wording added with #29 (narration sends model numbers to Anthropic).
- A live narration check on production (the API key is set).
- The two-browser Realtime test: presence plus live changes.
- #27: the timed Copperleaf run.

## Performance (parked until the end of the build)

PRD §6.7 targets:
- Pipeline-only Northbeam, re-run after a lever change: < 150 ms.
- Full seeded Northbeam with its client roster and servicing: < 250 ms. It's roughly twice the cost because
  servicing simulates the 26 clients' ongoing work as well as the pipeline.

Both are tested in `apps/web/test/scenarios.test.ts`. The engine was optimised twice during #19, with
byte-identical results. Further work, starting with profiling the servicing
simulation, waits for Austin's end-of-build review.

## Follow-ups (not ticketed yet; raise with Austin when planning)

- MCP editing tools (`add_step`, `update_step`, …) open a draft (`beginEdit`) before validating names; a failed call
  leaves a harmless copy of live as a draft. `import_process` was fixed in #91 to write nothing on failure.
- `applyPlan` in `packages/mcp` isn't transactional: a DB error mid-write can leave a partial draft.
- Roles settings count usage from all step revisions via PostgREST (max 1000 rows), so a big workspace could
  under-count; the `in_use` trigger still refuses a bad delete. A count RPC would fix it.
- The services fallback-load editor and the client-assignment roster still list inactive roles.
- Extraction: routing (edge) probabilities have no evidence or provenance, so routing conflicts aren't tracked;
  register the skill as an MCP prompt so Claude desktop needs no install; add clients, services and lead sources to
  `get_workspace_summary`; a `list_sources` tool; range citations (`value_min`/`value_max`).
- The extraction fixture lint doesn't check new steps inside a `target` import (the e2e test does).

## Other open items

- [ ] Upgrade Supabase and Vercel to Pro before real client data (PRD D2).
- [ ] DPA clause in the retainer contract (PRD D20).
- [ ] Custom SMTP for Supabase auth emails before inviting clients.

## Things worth knowing

- **Next.js 16:** `proxy.ts` replaces middleware, and request APIs are async. Read `apps/web/AGENTS.md` and the
  bundled docs before writing Next code.
- **Demo mode:** without Supabase env vars, the app redirects to `/demo`, which runs Northbeam from the fixtures.
- **Engine determinism:** never use `Math.log`/`Math.exp` in the engine; use `det-math.ts`. Any change that moves
  golden-model numbers needs an `ENGINE_VERSION` bump and `golden:approve` (see `docs/engine-versioning.md`).
- **Fixtures are the source of truth for sample data:** after changing them or a migration, run
  `pnpm --filter @transpera-flow/db gen:seed` and `gen:bootstrap`. CI fails if either is stale.
- **Plain Postgres vs Supabase:** anything verified only against plain Postgres goes in `docs/supabase-notes.md`.
