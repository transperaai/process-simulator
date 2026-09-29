# Handover: connect Supabase and Vercel, then carry on building

Written 29 Sep 2026 at the end of the first build session. Work lives on branch
`claude/charming-cannon-2jmd09` (not merged to `main` yet). CI is green on every
commit.

## Where things stand

**Built and tested** (see the GitHub issues for detail):

| Ticket | State |
|---|---|
| #4 Walking skeleton | Done: monorepo, engine in a Web Worker, schema + RLS, seed, read-only canvas, KPI strip, magic-link auth, CI |
| #5 Engine correctness | Done: queueing-theory tests, per-purpose random streams, heap, portable log/exp (browser = server byte for byte) |
| #7 Ranges everywhere | Done: every KPI is average + 10–90% range |
| #6 Named people | Done except the **people settings form** (create/edit/deactivate), which saves data and waited for Supabase |

**Supabase project** `vgsjkpwvxkpqvyazwcyq` (free/Nano plan for now):
- `packages/db/supabase/bootstrap.sql` has been run in the SQL editor: both migrations,
  the Northbeam seed, and the migration-history rows. Verified: 1 workspace, 12 steps, 11 people.
- Not done yet: auth URL config, making Austin agency admin, RLS spot-check on the live DB.

**Vercel**: project created from the repo with Root Directory `apps/web`. Not done yet:
env vars, and it deploys `main`, which is still empty (see step 4 below).

**Why a local session:** the cloud environment's network policy blocks Supabase and
Vercel, so the next session should run on Austin's computer (Remote Control), where
the CLIs use his logins and network.

## Security to-dos (do these first)

- [ ] **Rotate the Supabase access token.** Two tokens were pasted into the first chat;
      revoke both at supabase.com/dashboard/account/tokens. The cloud environment's
      `SUPABASE_ACCESS_TOKEN` variable holds one of them: update or delete it.
- [ ] Never commit tokens. `.env*` is git-ignored; keep secrets in `apps/web/.env.local`
      and Vercel's env settings only.

## Option B: run Claude Code on your own computer

One-time setup in a terminal:

```sh
git clone https://github.com/transperaai/process-simulator.git
cd process-simulator
git checkout claude/charming-cannon-2jmd09
corepack enable            # gives you pnpm 10 (Node 22 required)
pnpm install
npx supabase login         # opens the browser
npx vercel login
claude remote-control      # or open this folder in the Claude Desktop app
```

For the full test suite locally you also need Postgres 16 and Chromium:

```sh
docker run -d --name flowsim-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
pnpm --filter @flowsim/engine exec playwright-core install chromium
pnpm lint && pnpm typecheck && pnpm test
```

## Steps for the next session

1. **Link Supabase** (from the repo root):
   ```sh
   npx supabase link --project-ref vgsjkpwvxkpqvyazwcyq --workdir packages/db
   npx supabase migration list --workdir packages/db   # both migrations should show as applied remotely
   ```
   If `link` warns about the Postgres version, set `db.major_version` in
   `packages/db/supabase/config.toml` to match the project.

2. **Spot-check RLS on the live database** (SQL editor or `supabase db query`): a signed-in
   stranger must see nothing.
   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
   select count(*) from people;   -- expect 0
   rollback;
   ```

3. **Auth settings** (Supabase dashboard → Authentication → URL Configuration): Site URL =
   the Vercel production URL; add `<vercel-url>/auth/callback`, the preview pattern
   `https://*-<team>.vercel.app/auth/callback`, and `http://localhost:3000/auth/callback`
   to Redirect URLs.

4. **Get `main` deployable**: open a PR from `claude/charming-cannon-2jmd09` to `main`
   and merge it (or point Vercel's production branch at this branch for now).

5. **Vercel env vars** (from the repo root, after `npx vercel link` to the existing project):
   ```sh
   npx vercel env add NEXT_PUBLIC_SUPABASE_URL           # https://vgsjkpwvxkpqvyazwcyq.supabase.co
   npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   npx vercel env pull apps/web/.env.local
   ```
   Add each to Production, Preview and Development. The publishable key is under Supabase
   → Project Settings → API Keys. Then redeploy.

6. **First sign-in**: open the deployed site, sign in with Austin's email, then run
   `packages/db/scripts/make-agency-admin.sql` (with that email) in the SQL editor, and sign
   out and back in. `/` should list Northbeam; `/w/northbeam` shows the canvas.

7. **Work through `docs/supabase-notes.md`** ("Things that may need changes"), checking off
   what's verified: auth.uid/jwt, agency-admin flag refresh, anon grants, redirect URLs,
   email rate limits (set up custom SMTP before inviting clients), people loading.

8. **Replace hand-written DB types** with `npx supabase gen types typescript --linked --workdir packages/db`
   output, and use it in `apps/web/src/lib/data.ts`.

## Then continue building (Milestone A)

Next tickets, in order:

1. **#6 people settings form**: the first write path. Settles the pattern for per-field
   saves with version checks (PRD decision D14) that #8 reuses.
2. **#8 canvas editing**, including on-canvas node editing, inline edits, context menu, undo/redo.
3. **#15 levers + scenarios + compare**, then **#14 playback animation** (trace already records who did each step).
4. **#9 draft mode** and **#10 presence** (needs Realtime enabled on the tables).
5. Engine-only tickets that are safe any time: #11 warm-up + current WIP, #12 services + revenue, #13 demand.

Work the frontier: any open ticket whose "Blocked by" issues are all closed. Close #4,
#5 and #7 once the live checks above pass (#6 after the settings form).

## Other open items

- [ ] Create the five triage labels on GitHub (`needs-triage`, `needs-info`,
      `ready-for-agent`, `ready-for-human`, `wontfix`) and apply them; ticket status is
      currently written in each issue body.
- [ ] Upgrade Supabase to Pro and Vercel to Pro before real client data (PRD D2).
- [ ] DPA clause in the retainer contract (PRD D20).
- [ ] Custom SMTP for Supabase auth emails before inviting clients.

## Things worth knowing

- **Next.js 16**: `proxy.ts` replaces middleware; request APIs are async. Read
  `apps/web/AGENTS.md` and the bundled docs before writing Next code.
- **Demo mode**: without Supabase env vars the app redirects to `/demo`, which runs
  Northbeam from the fixtures. Handy for UI work.
- **Engine determinism**: never use `Math.log`/`Math.exp` in the engine; use `det-math.ts`.
  The browser-vs-Node byte-identity test will catch it.
- **Fixtures are the source of truth for sample data**: after changing them or a migration,
  run `pnpm --filter @flowsim/db gen:seed` and `gen:bootstrap` (CI fails if stale).
- **Engine numbers moved from the prototype** after the stream fix: Northbeam now shows
  ~7.5 wins/quarter and the strategist at ~92% (prototype: 7.1 / 91%). Parity is statistical.
