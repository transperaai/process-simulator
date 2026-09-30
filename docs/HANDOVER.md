# Handover

Updated 30 Sep 2026, at the end of the Milestone A build session. Start a new session with:

> Read `CLAUDE.md` and `docs/HANDOVER.md`, then carry on from "Next steps".

## Where things stand

**Milestone A (#1, Audit-ready):** every ticket is merged to `main` and live on
https://transpera-flow.vercel.app except:

- **#27 A24: Transcript to draft, end to end** (`ready-for-human`): a QA pass with Austin, not a build.
- **Milestone A QA with Austin**: he tests the whole flow on his PC, then does a polish and flow review.
  He wants the backlog from that review gathered in one go, not iterated on mid-way.

**Milestones B (#2) and C (#3):** not started. Tickets #30–#43 are `ready-for-agent`; #44 is `ready-for-human`.
Work the frontier: any open ticket whose `Blocked by` issues are all closed.

**Production database:** every migration in `packages/db/supabase/migrations/` is applied (up to
`20261020000000_narration`). See `docs/production-migrations.md`.

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
- `ANTHROPIC_API_KEY` is set in Vercel (Production and Preview) for narration (#29). Without it, reports print
  the templated summary.

## Open items for Austin's QA

- The lost-revenue definition, and the starter scenarios.
- Larkspur (the second sample workspace) is not seeded in production.
- The /privacy wording added with #29 (narration sends model numbers to Anthropic).
- A live narration check on production (the API key is set).
- The two-browser Realtime test: presence plus live changes.
- #27, done together.

## Performance (parked until the end of the build)

PRD §6.7 targets:
- Pipeline-only Northbeam, re-run after a lever change: < 150 ms.
- Full seeded Northbeam with its client roster and servicing: < 250 ms. It's roughly twice the cost because
  servicing simulates the 26 clients' ongoing work as well as the pipeline.

Both are tested in `apps/web/test/scenarios.test.ts`. The engine was optimised twice during #19, with
byte-identical results. Further work, starting with profiling the servicing
simulation, waits for Austin's end-of-build review.

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
- **PDF reports on Vercel:** `apps/web/next.config.ts` traces Chromium's real `bin/` path (not the pnpm
  symlink). Keep it that way or the PDF route returns 500s.
- **Plain Postgres vs Supabase:** anything verified only against plain Postgres goes in `docs/supabase-notes.md`.
