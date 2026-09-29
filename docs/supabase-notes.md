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
3. Apply migrations: `npx supabase link --workdir packages/db` then
   `npx supabase db push --workdir packages/db`.
4. Load the seed: run `packages/db/supabase/seed.sql` in the SQL editor (or
   `supabase db reset` locally, which runs it automatically).
5. Auth → URL configuration: set the site URL and add
   `https://<your-domain>/auth/callback` (and Vercel preview URLs) to the redirect allow-list.
6. Sign in once with your email, then run `packages/db/scripts/make-agency-admin.sql`
   (with your email) and sign out/in again.

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
| Google sign-in | Not built yet (ticket B1) | Needs a Google OAuth client configured in Supabase Auth. |
| Generated types | `packages/db/src/types.ts` is hand-written | Replace with `supabase gen types typescript` output and keep it in CI. |
| Numeric columns | `numeric` columns come back as strings from `pg`, and the code wraps them in `Number(...)` | supabase-js/PostgREST returns them as JSON numbers; both paths are handled, but check any new code does the same. |
| Deferred FKs | `processes.live_revision_id` FK is `deferrable initially deferred`; the seed inserts the process first and links the revision last | Fine on Supabase; noted in case the SQL editor runs statements separately. |
| Realtime | Not used yet (ticket A7) | Enable Realtime on the relevant tables when that ticket lands. |
| Storage | Not used yet | Buckets and storage RLS policies come with sources, reports and branding tickets. |
| Loading people (#6) | `apps/web/src/lib/data.ts` fetches people, person_roles, person_skills and person_leave with supabase-js; only the SQL/RLS side is tested | Open a workspace page with a real project and confirm the People view lists everyone. Dates come back as `YYYY-MM-DD` strings from PostgREST, which the leave conversion expects. |
| Per-person visibility | People tables are readable by every workspace member for now | PRD §2: members should see only their own record. That RLS change lands with roles and visibility (#30). |
| Proxy (middleware) | `src/proxy.ts` refreshes the session with `@supabase/ssr` | Next.js 16 renamed middleware to proxy; confirm session refresh works on Vercel's runtime. |
