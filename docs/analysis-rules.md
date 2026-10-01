# Analysis rules

Agreed with Austin, 1 Oct 2026, in the analysis rules session. This replaces the detector thresholds in
`packages/engine/src/issues.ts` (`DEFAULT_ISSUE_THRESHOLDS`) and the four engine severities. Nothing here is built yet;
it is the spec for the tickets that follow.

**Built so far (A41, issue #106):** the rating model and rules 1, 3, 4, 5, 6 and 7 are in
`packages/engine/src/ratings.ts` and the detectors (`issues.ts`, `overtime-issues.ts`). The rules not listed there still
run their old logic, mapped onto ratings until their tickets land. Choices the spec left open:

- A value exactly on a cut-off belongs to the higher band ("70%" is Good, "85%" is Bad), except rule 5, where it belongs
  to the lower one ("within 1×", "up to 1.5×").
- Overtime is rated on the share of the overtime cap used (any regular overtime is 1% of it; the cap used up is 95%).
- Rule 4 is rated on the average alone: queue growth is too noisy in a single run to read a bad month from.
- A band a rule doesn't have (overtime's Good, rule 4's Good and Bad) is skipped when an escalator raises a rating.
- The bottleneck escalator raises a finding that is already worse than Great (after a bad month, if any); a Great that
  is merely on the bottleneck stays Great.
- Overrides: the most specific match wins (person, step, role, service, process); a field it leaves unset falls through.
  A servicing step belongs to its servicing process and to the services that run it.
- Stored issues keep the database's four `severity` values, which stand for the ratings one to one (critical = Operational
  risk, serious = Bad, warning = Good, info = Great).

## The rating scale

Every rule turns a number from the simulation into one rating:

| Rating | Meaning |
|---|---|
| **Great** | Working well. Protect it. |
| **Good, could improve** | Fine today, with something to gain. |
| **Bad, not urgent** | Costing time or money. Plan a fix. |
| **Operational risk** | Could break delivery or lose clients. Fix now. |

Each rule has three cut-offs that split its number into these four bands. A step, role or process is **Great** when
every rule that applies to it rates it Great.

### Escalators

The band is set by the **average** across the 30 runs. Two things can raise it:

1. **Bad month.** If the 90th percentile (P90) crosses the next cut-off, the rating goes up one level.
2. **On the bottleneck.** If the finding is on the current bottleneck (step, role or person), it goes up one level.

The two can stack. A rating can't go higher than Operational risk.

Example: Northbeam's strategist averages 82% busy, so Good, could improve. A bad month hits 97%, which crosses 85%, so
the rating rises to Bad. She is also the bottleneck, so it rises again to Operational risk. Today's engine doesn't flag
her at all, because 82% is under its single 85% threshold.

### Cost per month

Every insight shows an estimated cost per month in the workspace currency. The default currency for new workspaces is
**AUD**. Within a rating, insights are sorted by this cost, highest first. The cost is always labelled as an estimate.

**What a loss is worth** (decided 1 Oct): the revenue still to come at the moment it's lost, capped at **12 months**.

- **Before signing**, a lost lead or deal is worth the deal value × the chance it would still have signed from that
  step. With Northbeam's routing, a lead lost at Check fit is worth about 12% of a deal, and one lost at Client decision
  about 32%.
- **After signing**, a churned client is worth its monthly fee × the tenure it had left, from the month it churns.
  Losing a client in month 2 of a typical 22-month tenure counts 12 months (the cap); losing one in month 20 counts 2.
- **Deal value** is the service's monthly fee × typical tenure (one-off price for one-off services), capped at 12
  months.

**Methods per rule** (decided 1 Oct where marked):

- **Busy role or person** (decided): work lost. The engine's shadow price gives the extra wins one more person would
  bring; cost = those wins × deal value, plus any overtime cost.
- **Long wait** (decided): through drop-off. Each pipeline step gets an optional **lost per day of waiting** (e.g. 5%
  of leads go cold per day). Cost = items lost to waiting × what a loss is worth at that step. With none set, the
  insight shows time, not money.
- **Single point of failure**: the damage of one absence (from the absence test) × absences a year (default 2) ÷ 12.
- **Client health, churn driver, SLA missed**: churned clients × what a loss is worth after signing.
- **Drop-off**: items lost above the benchmark × what a loss is worth at that step.
- The rest are listed in the table below.

### Editing the rules

Everything in this document is a workspace default, editable in **Settings → Analysis rules**:

- Each rule can be switched **on or off**.
- Each rule's **cut-offs** can be changed. The screen shows the default next to each number and previews the four
  bands as you type.
- A rule can be **overridden** for one role, person, step, service or process (e.g. a lower busy limit for a person
  nobody can cover, or a shorter expected wait for replying to leads). Overrides are listed on the rule.
- The two **escalators** (bad month, bottleneck) can each be switched off.
- The money settings and defaults below are editable: the 12-month cap, the absence-test length and how often it
  happens, and the default expected waits.
- **Reset to default** works per rule, and for all rules at once.

Changing a rule re-rates the latest run straight away; it doesn't need a new simulation.

## The rules

| # | Rule | Number it rates | Great | Good, could improve | Bad, not urgent | Operational risk | Cost per month (estimate) |
|---|---|---|---|---|---|---|---|
| 1 | **Busy role or person** | Simulated utilisation | under 70% | 70–85% | 85–95% | over 95% | Extra wins one more person would bring × deal value, plus overtime |
| 2 | **Spare capacity** | Simulated utilisation | n/a | under 40%, shown as an opportunity ("about N h a week free") | n/a | n/a | Cost of the idle hours at cost rates |
| 3 | **Overtime** | Overtime hours | none | n/a | any regular overtime | overtime cap used up | Overtime hours × cost rate |
| 4 | **Queue keeps growing** | Queue growth per week | n/a | n/a | n/a | 0.5 or more items a week (always) | Value of work stuck in the queue |
| 5 | **Long wait** | Average wait for a person ÷ the step's expected wait | within 1× | up to 1.5× | up to 3× | over 3× | Items lost through the step's "lost per day of waiting" × value |
| 6 | **Rework** | Simulated share of work done twice | under 5% | 5–10% | 10–20% | over 20% | Repeated hours × cost rate |
| 7 | **SLA missed** | Share of visits over the step's SLA | under 5% | 5–10% | 10–25% | over 25% | Through the churn drivers when the step is client work |
| 8 | **Single point of failure** | Absence test: work lost and weeks to recover | under 5% lost, back within 1 week | n/a | 5–20% lost or 1–4 weeks | over 20%, over 4 weeks, or a client SLA missed | Damage of one absence × absences a year ÷ 12 |
| 9 | **Client health** | Simulated health of each client group (per service) | 75+ | 65–75 | 50–65 | under 50 | Churned MRR × expected tenure |
| 10 | **Churn driver** | A driver's share of simulated churn | n/a | n/a | 30% or more | 30% or more and the client group is under 50 | That driver's share of churned MRR |
| 11 | **Success measure** (first principles) | Share of runs that meet the measure's target | 80%+ | 50–80% | 20–50% | under 20% | Depends on the measure |
| 12 | **Drop-off between steps** | Share of work lost at a step, against a benchmark set per step | at or better | up to 1.25× the benchmark | up to 1.5× | over 1.5× | Lost items × expected value |
| 13 | **Cycle time vs target** | End-to-end time for a process, against its target | within target | up to 1.25× | up to 1.5× | over 1.5× | Revenue delayed |
| 14 | **Sources disagree** | Ratio between two sources' numbers for one parameter | n/a | n/a | 2× or more | n/a | n/a (a data-quality finding) |
| 15 | **Broken solution** | A saved solution points at something that no longer exists | n/a | n/a | always | n/a | n/a |

Notes:

- **Rule 1 and 2:** under 70% is Great for workload. Under 40% also raises a separate "spare capacity" opportunity.
  Sales at 12% would be Great on rule 1 and show a Good, could improve opportunity on rule 2.
- **Rule 5:** wait means time queued for a person, not built-in delays like "the client decides" (as today). A step's
  expected wait is set on the step. With none set, it defaults to 1 working day for pipeline steps and 2 for servicing
  steps.
- **Rule 6:** rated from what the simulation shows, not from the rework rate typed into the model (today's behaviour).
- **Rule 8** (decided 1 Oct): the engine runs an extra simulation with the person away for 2 weeks and compares it
  with the baseline, on two numbers: work lost (throughput) and weeks until their queues are back to normal after they
  return.
  - **Great:** under 5% lost and back to normal within 1 week.
  - **Bad, not urgent:** 5–20% lost, or 1–4 weeks to recover.
  - **Operational risk:** over 20% lost, not recovered within 4 weeks, or any client-facing SLA missed.
- **Rules 9 and 10:** replace today's per-client rule. They use client groups per service and the churn drivers in
  Settings.
- **Rule 11:** reads the success measures from the process's first principles (`docs/research/first-principles.md`).
  A measure the simulation can't compute is not rated.

## What AI does

AI analysis runs alongside the rules. It reads:

- the rule results;
- each process's first principles;
- the linked sources.

It writes insights marked **AI**. It may suggest a rating, but every number it uses comes from the simulation, and its
insights go through the same Acknowledge step as rule insights. AI also runs the first-principles checks (see the
research note), such as automation proposed for a step that is still a delete candidate.

## Changes from today

- One rating scale instead of critical / serious / warning / info.
- Average plus P90 instead of average only; bottleneck escalation.
- Per-step expected waits instead of one 16 h threshold.
- Rework from simulated results, not inputs.
- Absence test instead of flagging every one-person step.
- Client groups and churn drivers instead of named-client health.
- New rules: spare capacity, success measures, drop-off, cycle time vs target.
- A cost per month on every insight, in the workspace currency (default AUD).
