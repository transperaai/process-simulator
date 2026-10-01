# Engine versioning and golden models

The engine's numbers are the product, so none may move unnoticed (docs/PRD.md §6.9 layer 3, decision D16;
issue #22; ADR 0009). Three golden models are run at a fixed seed on every push, their key outputs are compared
exactly with approved baselines, and every change that moves one needs a new baseline and a new `ENGINE_VERSION`,
which every run records.

## What is locked

| Golden model | Fixture | What it covers |
|---|---|---|
| `northbeam` | `northbeamModel()` | The prototype's model, re-baselined after the §6.8 fixes: pooled head-counts, one implicit retainer, automatic warm-up. |
| `northbeam-seeded` | `northbeamWithServicing()` | Northbeam as the seed loads it: SEO and PPC services with condition-tag routing, 11 named people, the 26-client roster, a 10% overtime cap, and two servicing processes whose late and missed tasks move health and churn. |
| `larkspur` | `larkspurModel()` | Larkspur Creative, the "second, messier sample agency" (§6.9): overloaded designers, a copywriter past her week on overtime, an 18-client named roster whose health drives churn, and the corners Northbeam leaves alone (below). |

Each runs with the app's defaults, 30 replications at seed 1. The outputs kept (`keyOutputs` in
`packages/engine/test/golden.ts`) are throughput (won, lost, done, wins a week), cycle time (mean, P50, P90), new
MRR, billed, LTV added and lost revenue, labour, overtime hours and cost, clients at risk and churned, servicing
touchpoints, the bottleneck role, step and person, utilisation per role (total with its 10–90% range, and its
pipeline, client, servicing and overtime shares) and per person, each step's arrivals, departures, queue, wait,
WIP and SLA breaches, and each roster client's final health, churn and at-risk shares.

The baselines are `packages/engine/golden/<model>.json`, one metric per line so a diff reads as a list of what
moved. `golden/versions.json` is the ledger: every approved version, the date, why the numbers moved, and a sha256
of all the baselines' outputs at that version.

**No tolerances.** Comparisons are exact. The engine is deterministic: per-purpose random streams, portable
`log`/`exp` (`det-math.ts`), and otherwise only IEEE arithmetic and `Math.sqrt`, which are correctly rounded
everywhere. `browser-determinism.test.ts` checks every golden model gives byte-identical results in Node and a
Chromium worker. A change that only reorders floating-point sums moves the last digit, and that is still a change
to review: approve it like any other.

### Larkspur's messy corners

Larkspur (`packages/engine/src/fixtures/larkspur-data.ts`, shared with the seed) has a 37.5-hour week; a founder
in two roles pinned to pitch calls; a part-timer, a contractor with their own hours and rate, and a specialist
limited by skills; two people on leave; triangular, constant and custom-spread lognormal distributions; 25–30%
rework; two lost ends; step SLAs; work in progress at two steps instead of a warm-up; seasonality with 1% monthly
growth; a retainer on servicing (monthly calendar, Poisson ad-hoc requests), a retainer on fallback load, and
one-off website builds whose clients keep a care plan; a client with no health entered; and non-default health
rules. `larkspur.test.ts` checks it stays overloaded, on overtime and churning on health, so a later re-baseline
can't quietly make it tidy.

## When a golden test fails

The failure names the model and prints the numbers that differ. Then either:

- **The change was not meant to move numbers.** Fix the change.
- **It was.** Approve the new baseline, from the repo root:

  ```sh
  pnpm --filter @transpera-flow/engine golden:approve "Servicing tasks now queue behind pipeline work at equal priority"
  ```

  This reruns the golden models, prints every value that moved, rewrites `packages/engine/golden/`, bumps
  `ENGINE_VERSION` in `packages/engine/src/version.ts` to the next minor version (1.0.0 → 1.1.0), appends the
  version, the date and your reason to `golden/versions.json`, and reruns the golden tests. Commit the
  baselines, the ledger and `version.ts` in the same commit as the engine change, and say in the PR why the
  numbers moved. Reviewers read the baseline diff.

Options: `golden:approve --bump "why"` bumps even when no snapshotted number moved (an engine change the key outputs
don't show, such as a new result field whose meaning matters). For a major version, raise `ENGINE_VERSION` by hand
first (`2.0.0`), then approve: approval keeps a version above the ledger's last.

Adding or removing a golden model, or changing the outputs kept, also changes the baselines: approve it the same
way.

### What stops a baseline changing without a bump

`golden.test.ts` fails unless all of these hold:

1. Each model's outputs equal its baseline exactly.
2. Each baseline records `engineVersion` equal to `ENGINE_VERSION`.
3. `ENGINE_VERSION` is the ledger's last entry, and the sha256 of the baselines on disk equals the digest recorded
   for it. A baseline edited by hand, or regenerated without approving, no longer matches, so CI fails until it is
   approved, which bumps the version.
4. Ledger versions only increase, and each has a reason.

## Where the version goes

- `SimulationResult.engineVersion` on every run, in the browser worker and on the server.
- Saved runs: `runs.engine_version` (the column has existed since #25; no migration). The run page shows
  "engine 1.0.0" and, when the engine has changed since the run was saved, a note that running the same model again
  can give different numbers. Runs saved before this record none ("engine version not recorded").
- MCP: `run_scenario`, `compare_scenarios`, `check_robustness` and `get_bottlenecks` return `engine_version`.
- Reports: the PDF report (#28) should print `ENGINE_VERSION` on its methodology page.
- Caches: the robustness cache is in memory for one tab, so a deploy clears it. A cache that outlives a deploy must
  include `ENGINE_VERSION` in its key.

## Northbeam, re-baselined

PRD v0.2 expected "strategist ~91%, ~7 wins a quarter at seed 1" from the prototype. After the §6.8 fixes, engine
1.0.0 gives, for `northbeamModel()` at seed 1, 30 replications, 13 weeks:

| | Engine 1.0.0 | Prototype (v0.2) |
|---|---|---|
| Strategist utilisation | 84.5% (range 73–99%) | ~91% |
| Wins a quarter | 10.4 (range 7–14) | ~7 |
| Lost | 78.2 | |
| Cycle time | mean 198 h (≈ 5 weeks), P50 188 h, P90 260 h | |
| New MRR | £39,393 (range £26,600–£53,200) | |
| Bottleneck | Strategist, at Audit & proposal | Strategist, at Audit & proposal |

Why they differ:

1. **7 leads a week, not 12.** At 12 the lone strategist gets about 38 hours of audits and kickoffs a week against
   the 30 left after client work, so the queue grows without bound and every number depends on how long the run
   went on. At 7 the strategist is still the bottleneck but the business reaches a steady state
   (`prototype-parity.test.ts` checks the fixture is otherwise the prototype's `BASE_MODEL`).
2. **A warm-up** (§6.8 item 6): the prototype starts from an empty business, so its first weeks have nothing in
   flight and it under-counts wins. The engine discards an automatic warm-up (430 hours here) first.
3. **Ongoing load from the live client count** (§6.8 item 2): the prototype reported client work from the starting
   26 clients while it used the live count for capacity.
4. **Separate random streams per purpose** (§6.8 item 1): the same seed draws different samples. Over 300
   replications the port still agrees with the prototype run the prototype's way (`prototype-parity.test.ts`).

Northbeam as seeded (`northbeam-seeded`: services, named people, its roster and servicing) gives strategist 82.2%,
11.6 wins, 4.9 clients churned and 1.0 at risk a quarter. Larkspur gives 21.7 wins in 26 weeks, the copywriter at
110% with 105 hours of overtime, designers at 85%, 8.8 clients at risk and 10.3 churned. The baselines hold the
rest.

## Where Larkspur lives

- Engine: `larkspurModel()` from `packages/engine/src/fixtures/larkspur.ts`, built from `larkspur-data.ts`.
- Seed: `larkspurBundle()` in `packages/db/src/fixtures/larkspur.ts`, in `seed.sql` and `bootstrap.sql` beside
  Northbeam (slug `larkspur`), so it loads locally (`supabase db reset`) and on preview branches, which run the
  seed. `packages/db/test/larkspur.test.ts` checks the rows resolve on 5 October 2026 to exactly
  `larkspurModel()`; `database.test.ts` checks the seeded database round-trips to the same model.
- App: `/demo/larkspur`, read-only from the fixtures, on any deployment.
- Production: not loaded. It is a test and demo agency; add it by hand only if wanted.

## Nested models (issue #102)

A step can hold its own steps: a group, or a child process. The engine flattens a nested model to leaf steps before every run
(`flattenModel` in `packages/engine/src/flatten.ts`, called by `simulate`, `runOnce` and `initialState`; a model with no groups comes back
as the same object). A nested model therefore gives exactly the numbers of the same model drawn flat, which `test/nesting.test.ts` and
`packages/db/test/nested-model.test.ts` check, and the golden models (all flat) did not move: introducing groups needed no `ENGINE_VERSION` bump.
Draw a group open or closed, or move a step into one, and no number changes; adding or removing steps still does, as before.
