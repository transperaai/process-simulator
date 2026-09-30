# Transpera Flow

Process-map simulator: turns a company's workflows into a runnable
discrete-event Monte Carlo model. Product spec and decisions: [`docs/PRD.md`](docs/PRD.md).
Work is tracked as GitHub issues (milestone parents #1–#3). Picking this up? Start with [`docs/HANDOVER.md`](docs/HANDOVER.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 app (App Router, Tailwind v4, React Flow) |
| `packages/engine` | Simulation engine, shared by the browser (Web Worker) and Node |
| `packages/db` | Supabase migrations, seed, row types, row → engine model mapping |
| `packages/mcp` | MCP server: tools and the `/api/mcp` request handler (see below) |
| `prototype/` | The original single-file prototype; the engine port is tested against it |

## Develop

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

Without Supabase settings the app runs in **demo mode** (`/demo`), showing the
Northbeam sample from the seed fixtures. To use a database, copy
`apps/web/.env.example` to `apps/web/.env.local` and fill it in; see
[`docs/supabase-notes.md`](docs/supabase-notes.md).

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test           # database tests need Postgres, see below
```

Database tests create a throwaway database on the Postgres at `DATABASE_URL`
(default `postgres://postgres:postgres@localhost:5432/postgres`) and load a
small stand-in for Supabase auth, the migrations and the seed.

After changing the fixtures, regenerate the seed with `pnpm --filter @transpera-flow/db gen:seed`.

The MCP end-to-end suite (`packages/mcp/test/postgrest.test.ts`) also needs
PostgREST; it is skipped locally unless `POSTGREST_URL` and
`POSTGREST_JWT_SECRET` are set. CI prepares its database with
`packages/mcp/test/postgrest-db.ts` and then starts PostgREST (see
`.github/workflows/ci.yml`). To run it beside another checkout, set
`POSTGREST_DATABASE` to a database name of your own for both steps.

## MCP server

`/api/mcp` is a Streamable HTTP MCP endpoint (PRD §7.1). Create a personal
token under **API tokens** in the app (shown once; only its hash is stored),
then connect Claude Code:

```sh
claude mcp add --transport http transpera-flow https://<host>/api/mcp \
  --header "Authorization: Bearer tf_…"
```

Tools: `list_workspaces`, `set_active_workspace`, `get_workspace_summary`,
`get_process`, `run_scenario`, and the analysis tools `save_scenario`,
`compare_scenarios`, `check_robustness` (time-capped; a capped check is flagged
`partial`), `get_bottlenecks` (with the shadow price: extra completions per
quarter from one more FTE in the top bottleneck role; see
`packages/engine/src/shadow-price.ts`), `log_issue` and `list_issues`. The endpoint acts as the token's user under
RLS and uses only `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no extra environment variables. How it
does that without the service-role key:
[`docs/adr/0002-mcp-acts-as-user-via-pre-request.md`](docs/adr/0002-mcp-acts-as-user-via-pre-request.md).
