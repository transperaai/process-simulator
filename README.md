# Flowsim

Process-map simulator: turns a company's workflows into a runnable
discrete-event Monte Carlo model. Product spec and decisions: [`docs/PRD.md`](docs/PRD.md).
Work is tracked as GitHub issues (milestone parents #1–#3).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 app (App Router, Tailwind v4, React Flow) |
| `packages/engine` | Simulation engine, shared by the browser (Web Worker) and Node |
| `packages/db` | Supabase migrations, seed, row types, row → engine model mapping |
| `packages/mcp` | MCP server tools (placeholder) |
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

After changing the fixtures, regenerate the seed with `pnpm --filter @flowsim/db gen:seed`.
