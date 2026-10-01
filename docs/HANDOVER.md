# Handover

Updated 30 Sep 2026, at the end of the Milestone A build session. Start a new session with:

> Read `CLAUDE.md` and `docs/HANDOVER.md`, then carry on from "Next steps".

## Where things stand

**Milestone A (#1, Audit-ready):** every ticket is merged to `main` and live on
https://transpera-flow.vercel.app, including #88 (A29: new workspace, Roles in Settings, `upsert_role`). What's left
is Austin's QA:

- **Milestone A QA**: Austin works through `docs/qa/milestone-a.md` (196 items), then does a polish and flow
  review. He wants the backlog from that review gathered in one go, not iterated on mid-way. Findings arrive as a
  comment on #1 or in chat.
- **#27 A24: Transcript to draft** (`ready-for-human`): the extraction skill and QA pack are merged (#90). Austin's
  timed run follows `docs/extraction/qa/README.md` on the **Copperleaf Marketing (QA)** workspace (`copperleaf-qa`),
  already set up in production. He has no real transcripts, so the Copperleaf interviews are the test material.
  Findings go on #27.

- **#93 A30: shadcn/ui and a sidebar app shell.** PR 1 (#94: shadcn setup, theme tokens aliased to ours, sidebar
  shell, map page with a docked right-hand panel) is merged. **PR 2 (restyle the remaining pages) is paused** until
  Austin's QA list is triaged: no point restyling pages he may remove. Austin is happy with the direction "for now";
  he plans to build a UI kit and we'll refine against it later. Known visual follow-ups for the map page (agreed
  worth doing, not yet ticketed): fit the map to the canvas with bigger nodes; show 5–6 headline KPI cards with the
  rest behind "More"; make the demo notice a small dismissible line; restyle the canvas toolbar as a floating
  shadcn toolbar.

**Milestones B (#2) and C (#3):** not started, and **on hold** until Austin's QA list is triaged (see Next steps).
Tickets #30–#43 are `ready-for-agent`; #44 is `ready-for-human`. Their specs predate Austin using the product, so
expect some to be rewritten or closed.

**Production database:** every migration in `packages/db/supabase/migrations/` is applied (up to
`20261021000000_roles_and_workspaces`). See `docs/production-migrations.md`.

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

Agreed with Austin on 30 Sep: **refine Milestone A before building Milestone B.** B builds directly on A's screens
and data (B1 roles, B2 People/Clients views, B6/B7 forecast), so building it first and then removing or reworking A
features would pay twice. Git conflicts aren't the risk (we build wave by wave); stale ticket specs are.

1. **Austin is writing a QA list** from `docs/qa/milestone-a.md`: things to **remove**, **refine** and **add**. He'll
   paste it into the new chat, possibly rough. Don't fix anything mid-list.
2. **Triage it** (Opus-level work) against `docs/PRD.md` and the open tickets:
   - removals and refinements → new tickets under #1 as a final Milestone A **polish wave** (numbered on from A30);
   - additions → tickets in the right milestone (A if it's needed to be audit-ready, otherwise B or C);
   - every B/C ticket the list affects → rewrite its spec, or close it `wontfix` with the reason;
   - record the decisions in the PRD decision log, and update `docs/qa/milestone-a.md` for anything removed;
   - fold in #93 PR 2 (restyle remaining pages) and the map-page visual follow-ups above, skipping removed pages.
3. **Show Austin the revised plan** (tickets per wave, what was cut or rewritten) and get his approval before
   building anything.
4. **Build:** the polish wave first (plan with Opus, build with Sonnet, review with Opus; apply any migrations to
   production as we go), then Milestone B on the corrected tickets.
5. Keep `docs/qa/milestone-a.md` and the #27 QA pack current as behaviour changes.

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
