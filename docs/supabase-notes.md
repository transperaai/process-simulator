# Supabase: things to check when we connect a real project

Everything database-related has so far been verified only against **plain
Postgres 16 with a small auth stand-in** (`packages/db/test/sql/auth-shim.sql`),
because Supabase's Docker images couldn't be pulled in the build environment.
When we move to a real Supabase project, work through this list; some items
may need code or migration changes.

## Setup steps (once)

1. Create a Supabase project (Pro plan per PRD D2) and a Vercel project for `apps/web`.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to Vercel
   (and to `apps/web/.env.local` for local dev). See `apps/web/.env.example`.
3. Apply migrations and seed. Either:
   - **SQL editor (works from a phone):** paste `packages/db/supabase/bootstrap.sql`
     into a new query and run it once. It contains every migration, the seed, and
     the migration-history rows so the CLI stays in sync afterwards.
   - **CLI:** `npx supabase link --workdir packages/db` then
     `npx supabase db push --workdir packages/db`, then run `seed.sql` in the SQL editor.
   Regenerate the bundle with `pnpm --filter @transpera-flow/db gen:bootstrap` after changing
   migrations or fixtures (CI fails if it's stale).
4. (Covered by the bootstrap bundle.)
5. Auth → URL configuration: set the site URL and add
   `https://<your-domain>/auth/callback` (and Vercel preview URLs) to the redirect allow-list.
6. Sign in once with your email, then run `packages/db/scripts/make-agency-admin.sql`
   (with your email) and sign out/in again.

The Claude Code environment's network policy currently blocks `api.supabase.com`
and `*.supabase.co`; allow them in the environment's Network access settings so an
agent can run migrations and checks directly.

## Verified on the live project (29 Sep 2026)

Project `vgsjkpwvxkpqvyazwcyq`, Postgres 17, production at https://transpera-flow.vercel.app.

- [x] Postgres version: `config.toml` set to 17; `supabase link` and `migration list` clean (both migrations applied).
- [x] `auth.uid()` / `auth.jwt()`: the real functions drive RLS as expected. A stranger's claims see 0 workspaces and 0 people; Austin's claims see 1 workspace and 11 people, with or without the `agency_admin` claim.
- [x] Grants: `anon` has no table privileges in `public` ("permission denied for table people"); every `public` table has RLS on.
- [x] API keys: new-style `sb_publishable_…` key in Vercel (Production, Preview, Development).
- [x] Agency admin: `make-agency-admin.sql` works against the real `auth.users` (`raw_app_meta_data`); after signing in, `/` and `/w/northbeam` load (200).
- [x] Proxy: session refresh works on Vercel (signed-in navigation across `/`, `/w/northbeam`).
- [x] Generated types: `packages/db/src/database.types.ts` from `pnpm --filter @transpera-flow/db gen:types`; `types.ts` keeps the narrowed app rows and fails the typecheck if they drift. Not in CI yet (CI can't reach Supabase); regenerate after every migration.
- [ ] Magic link: works only in the browser that requested it (PKCE code verifier cookie). Opening it elsewhere, e.g. from a phone's mail app, now shows "Sign-in failed: PKCE code verifier not found…" on `/login`. Consider the token-hash email template (`{{ .TokenHash }}` + `verifyOtp`) so links work across browsers before inviting clients.
- [ ] Preview-deployment sign-in (`https://*-transpera-ai.vercel.app/auth/callback` is in the allow-list; not tried yet).
- [ ] People view lists everyone on the live project (needs a look in the browser).
- [ ] Sign-out/in picks up a newly granted `agency_admin` flag (Austin's flag was set before his first session).
- [ ] Custom SMTP before inviting clients.

## Things that may need changes

| Area | What we assumed | What to verify on Supabase |
|---|---|---|
| Postgres version | Tested on Postgres 16; `config.toml` says 15 | Match `db.major_version` in `packages/db/supabase/config.toml` to the project's version; nothing in the migration is version-specific as far as we know. |
| `auth.uid()` / `auth.jwt()` | The shim mirrors Supabase's definitions (reads `request.jwt.claims`) | RLS tests pass against the real functions. Run the RLS suite against a Supabase branch/local stack once available. |
| Agency admin flag | Read from `app_metadata.agency_admin` in the JWT | The flag only appears in the JWT after the user's session refreshes; confirm sign-out/in picks it up. `raw_app_meta_data` column name in `make-agency-admin.sql` matches the current `auth.users` schema. |
| Grants | Migration grants table privileges to `authenticated` and revokes from `anon` | Supabase re-applies default privileges to `anon` for **new** tables. Every future migration must keep RLS on and repeat the revoke, or anon inherits privileges (RLS still blocks rows, but keep it tight). |
| API keys | App uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new-style `sb_publishable_…`) | If the project only shows a legacy "anon" key, it works in the same variable. |
| Magic-link redirect | `emailRedirectTo` is built from the request `origin` header | Works behind Vercel; check preview deployments are in the redirect allow-list, or links bounce to the site URL. |
| Email sending | Supabase's built-in mailer | Its rate limit is low (a few emails/hour). Configure custom SMTP before inviting clients. |
| Google sign-in | Built (#48); workspace access resolved at sign-in (#51) | Needs a Google OAuth client configured in Supabase Auth. The login action adds the `openid` scope so Google returns an ID token (the `hd` claim comes from it); check `custom_claims.hd` actually appears. |
| Generated types | `packages/db/src/types.ts` is hand-written | Replace with `supabase gen types typescript` output and keep it in CI. |
| Numeric columns | `numeric` columns come back as strings from `pg`, and the code wraps them in `Number(...)` | supabase-js/PostgREST returns them as JSON numbers; both paths are handled, but check any new code does the same. |
| Deferred FKs | `processes.live_revision_id` FK is `deferrable initially deferred`; the seed inserts the process first and links the revision last | Fine on Supabase; noted in case the SQL editor runs statements separately. |
| Realtime | Not used yet (ticket A7) | Enable Realtime on the relevant tables when that ticket lands. |
| Storage | Not used yet | Buckets and storage RLS policies come with sources, reports and branding tickets. |
| Loading people (#6) | `apps/web/src/lib/data.ts` fetches people, person_roles, person_skills and person_leave with supabase-js; only the SQL/RLS side is tested | Open a workspace page with a real project and confirm the People view lists everyone. Dates come back as `YYYY-MM-DD` strings from PostgREST, which the leave conversion expects. |
| Per-field saves (#6) | `save_fields` / `save_links` (migration `20260930000000_field_saves.sql`) were tested on plain Postgres. They're `security invoker` and lock with `select … for update`, so RLS update policies filter the rows. `anon` has execute revoked. | Apply the migration, then on `/w/<slug>/settings` edit a person as an editor and confirm it saves. Open the same person in two tabs and change one field in both to check the conflict prompt. Supabase's default privileges grant execute on new functions to `anon`; the migration revokes it, so check `anon` can't call `rpc('save_fields')`. The availability floor is only editable by owners and agency admins (workspaces update policy). |
| Workspace access (#51) | The shim's `auth.identities` stores Google's hosted domain as `identity_data.custom_claims.hd` (from GoTrue's `parseGoogleIDToken`; read from source, not observed). `resolve_my_access()` reads it there and `auth.users.email_confirmed_at` / `last_sign_in_at` | Sign in with a Google Workspace account and check `select identity_data from auth.identities where provider = 'google'` shows `custom_claims.hd`; a personal Gmail account must not. Confirm `/auth/callback` grants the pre-assigned role and the holding page shows for a stranger. Supabase's default privileges grant `execute` on new functions to `anon`/`authenticated`; the migration revokes it for the internal ones, so check `reconcile_access` is not callable via `/rest/v1/rpc`. |
| Per-person visibility | People tables are readable by every workspace member for now | PRD §2: members should see only their own record. That RLS change lands with roles and visibility (#30). |
| MCP pre-request hook (#23) | Migration `20260930040000_api_tokens.sql` runs `alter role authenticator set pgrst.db_pre_request = 'private.api_token_pre_request'` and `notify pgrst, 'reload config'` (Supabase's documented pattern). Tested against plain Postgres 16 and PostgREST v14.18 in CI, not against Supabase. | After applying: (1) `select rolconfig from pg_roles where rolname = 'authenticator'` shows the setting; (2) create a token at `/settings/tokens` and `curl -X POST https://<host>/api/mcp -H "Authorization: Bearer tf_…" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` lists five tools (a 503 means the hook is not active); (3) Supabase's API gateway passes the custom `x-api-token` header through to PostgREST; (4) a stranger's token sees 0 workspaces; (5) normal signed-in pages still load (the hook runs on every Data API request). |
| Proxy (middleware) | `src/proxy.ts` refreshes the session with `@supabase/ssr` | Next.js 16 renamed middleware to proxy; confirm session refresh works on Vercel's runtime. |
| Canvas editing (#8) | `apps/web/src/app/w/[slug]/actions.ts` inserts and deletes steps and edges with supabase-js and saves fields with `save_fields` keyed by `(revision_id, id)`, including one key of `work_params` / `wait_params` (`work_params.cv`). The SQL and RLS side is tested on plain Postgres (`packages/db/test/process-editing.test.ts`); the browser UI only against the in-memory demo store. | As an editor on `/w/<slug>`: drag a step and reload (position kept); add a step, connect it and reload (same step id; check `select id from steps` before and after); set a lognormal CV and a triangular range in the inspector and check `work_params` in the table; delete a step and undo (its edges come back). As a viewer the canvas is read-only. Open the process in two tabs and change the same step's hands-on time in both to see "keep mine / keep theirs". |
| Services (#12) | Migration `20261001000000_services.sql` (table, RLS, `save_fields` allow-list) is tested on plain Postgres 16 only (`packages/db/test/services.test.ts`). The entry-process foreign key uses `on delete set null (entry_process_id)`, which needs Postgres 15+. `path_tags` is `text[]`: `save_fields` round-trips it through `jsonb_populate_record`, and the seed inserts it as `array[…]::text[]`. `database.types.ts` was hand-written for the table, not generated. The settings UI was only checked in a browser with fixture data, not against a database. | After applying: regenerate types (`gen:types`) and check the diff is empty. As an editor on `/w/<slug>/settings`: add a service, change its price, mix share and path tags (e.g. `seo, content`), reload, and check `select path_tags from services` holds a text array; remove it. As a viewer the fields are read-only and the add form is hidden. Deleting a process clears only `entry_process_id` on its services. Supabase's default privileges grant `anon` access to new tables; the migration revokes it, so check `anon` can't `select` from `services` via `/rest/v1`. |
| Demand (#13) | Migration `20261004000000_demand.sql` (`lead_sources`, `seasonality`, `demand_settings`, RLS, the `stamp_provenance` trigger, `save_fields` allow-list) is tested on plain Postgres 16 only (`packages/db/test/demand.test.ts`). The trigger stamps `by` from `auth.uid()` (the shim's copy) and loops over `tg_argv`. `seasonality` is saved with the key `{workspace_id, month}`, the month sent as text and cast by `jsonb_populate_record`. A month or the growth with no row yet is inserted by the Server Action, which relies on PostgREST reporting an RLS insert failure as `42501` and a unique clash as `23505`. `database.types.ts` was hand-written for the three tables, not generated. The settings UI was only checked in a browser with fixture data (a temporary page), not against a database, so no save was exercised end to end. | After applying: regenerate types (`gen:types`) and check the diff is empty. As an editor on `/w/<slug>/settings`: add a lead source, change its leads a week (its badge turns from Estimated to Entered after the save), set January to 1.3 (inserts a `seasonality` row), set growth on a workspace without a `demand_settings` row (inserts one), reset seasonality; check `select provenance from lead_sources` shows `by` = your user id. As a viewer the fields are read-only and the add form is hidden. Check `anon` can't `select` from the three tables via `/rest/v1`. |
