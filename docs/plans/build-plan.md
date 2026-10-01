# Build plan: redesign wave (A31–A58)

How the redesign gets built, starting 1 Oct 2026 overnight. The tickets are in `docs/plans/redesign-plan.md` and on
GitHub under Milestone A (#1).

## Approved by Austin (1 Oct)

- Build with several agents at once.
- Open PRs and merge them to main.
- Apply migrations to production.
- Keep the GitHub tickets up to date.

## Step 0: groundwork PR

Merge the work already on `claude/dazzling-planck-2azomz` to main:

- the prototype;
- the plans;
- the analysis rules and research note;
- the shadcn preset.

CI is already green on it. Every ticket branch starts from main after this.

## How each ticket is built

1. A builder agent (Sonnet) works on its own branch, `claude/<ticket>-<slug>`, in an isolated copy of the repo. It
   comments on the ticket with the branch name.
2. It reads the ticket, the plan, the relevant prototype screen and CLAUDE.md. It builds with tests and commits and pushes
   after every step.
3. It runs lint, typecheck, the full test suite (with Postgres) and the web build, then opens a PR with `Closes #N`.
4. Review:
   - Opus reviews M and L tickets against the ticket and the prototype.
   - I review S tickets directly.
   - Findings are fixed on the same branch.
5. CI goes green. Then, for a ticket with a migration:
   - preflight checks;
   - apply it to production (additive only);
   - verify it;
   - log it in `docs/production-migrations.md`.
6. Squash-merge to main. The ticket closes and gets a comment saying what shipped.
7. Start whatever the merge unblocked.

Up to **four builders at once**. Two tickets that touch the same area are never merged at the same time: the second
merges main in and re-tests first.

## Order (by what blocks what)

| Round | Runs in parallel | Why this order |
|---|---|---|
| 1 | **A31** record the redesign · **A32** remove what's going · **A37** processes inside processes · **A41** rating engine | Nothing blocks these four. A37 and A41 both change engine numbers, so they merge one after the other, each with its own golden re-approval. |
| 2 | **A33** app shell v2 (after A32) · **A39** Editor screen (after A37) · **A43** cost per month, **A44** rules settings, **A57** market conditions (after A41) | Opened by round 1. |
| 3 | **A34** map v2 · **A40** process history · **A51** block library · **A42** new rules · **A55** client groups | Opened by round 2. |
| 4 | **A35** overview · **A36** processes page · **A38** process page · **A45** insights · **A56** churn drivers · **A58** levers and horizon | Mostly screens built on the new map. |
| 5 | **A47** issues data · **A54** first principles | |
| 6 | **A48** issues pages · **A49** solutions · **A46** AI analysis | |
| 7 | **A50** solution page · **A52** suggestions · **A53** sources must link | Last. |

**Overnight estimate:** rounds 1–2 should finish, and round 3 should be under way. The L tickets (A37, A41, A34, A39,
A49, A55, A56) each take several hours, with review. The rest carries on in the next session.

## Guardrails

- **Stop and ask Austin** before:
  - a destructive migration;
  - deleting data (named clients are hidden, never deleted);
  - anything the auto-mode classifier blocks.
- **Engine numbers** change only with an `ENGINE_VERSION` bump and a golden re-approval. The PR says why the numbers
  moved. The performance tests (PRD §6.7) must still pass.
- **CI red:** find the root cause and fix it. Never skip a test. If a ticket is still red after two real fix attempts, it
  is parked with a comment on the ticket and the PR, and the other lanes carry on.
- **Production:** migrations only, additive, verified after applying. No other production changes.
- **Every merge** keeps `docs/qa/milestone-a.md` and the handover current.

## What Austin sees in the morning

- A progress comment on #1 after each round: what merged, PR links, what's in progress, anything parked.
- `docs/HANDOVER.md` updated with where things stand.
- A short summary in this session: what's live on https://transpera-flow.vercel.app, and anything that needs a decision.
