## Draft: Monthly client report (new)

New process: 7 steps added (Send report, Pull ranking data, Month end, Write commentary, Report sent, Follow-up call, Director review); connections: 7 added, 0 removed, 0 changed.

Canvas: `/w/<slug>/p/78abbbc5-0d8b-4f61-aa26-54215abd2e33` (draft revision 1). Servicing process, entity `report`. Working day: 8 h (40 h week). The import returned `warnings: []` and no conflicts; 16 checklist items to confirm.

### Conflicts

None: one speaker so far.

Routing conflicts (not tracked by the app): none.

### Assumptions

Six values are cited by Hana, and ten are assumed with reasoning (every value is stored with a zero or a figure, never left to the server default).

| Step | Field | Value | Reasoning |
|---|---|---|---|
| Pull ranking data | wait_hours | 0 | Hana: "It just gets done"; the data lands in the shared folder and she gets a ping. |
| Pull ranking data | rework_rate | 0 | Nobody says the pull is sent back. The tracker export timing out (about once a fortnight) has no cost from Hana, so 0 until Owen answers. |
| Write commentary | wait_hours | 0 | Nothing is described as delaying the start of writing once the data lands. |
| Write commentary | rework_rate | 0 | Callum's send-backs are modelled as Director review's rework going to this step. |
| Director review | work_hours | 0.5 | Hana does not know and says he reads fast. A guess between Send report (0.25) and Write commentary (2.5). Ask Callum. |
| Director review | wait_hours | 0 | The day or two in his inbox is queueing, which the engine simulates from his workload. |
| Send report | wait_hours | 0 | Exporting to PDF and emailing happen straight away. |
| Send report | rework_rate | 0 | Client questions are routing to Follow-up call, not rework. |
| Follow-up call | wait_hours | 0 | Booked in the diary; no wait described. |
| Follow-up call | rework_rate | 0 | A call does not send the report back to an earlier step. |

Cited values (each with Hana's quote in the step's evidence): Pull ranking data `work_hours` 1 ("about an hour a client"); Write commentary `work_hours` 2.5 as a triangular range 2 / 2.5 / 3 ("call it two, three hours") and `current_wip` 4 ("I've got four half-written right now"); Director review `rework_rate` 0.2 ("One in five, I'd say"), back to Write commentary; Send report `work_hours` 0.25 ("A quarter of an hour, tops"); Follow-up call `work_hours` 0.5.

### Not overwritten

None: the process is new.

### Suggestions

Five pending, from Hana; nothing changes until someone accepts them on the Suggestions page.

- Claude suggests FTE 0.6 for Priti Rao, was 1, citing "she's three days a week now" (Hana Iqbal).
- Claude suggests adding person Jonah Pike (start date 2026-10-12, roles SEO specialist), citing "we've hired Jonah Pike, he's an SEO specialist, he starts on the twelfth of October" (Hana Iqbal). FTE was not stated, so the app defaults it to 1.
- Claude suggests MRR 2,900 for Marlow Physio, was 2,500 (and 1 more change: the Content add-on), citing Hana Iqbal.
- Claude suggests adding client Quayside Vets (services SEO retainer, account manager Hana Iqbal, SEO specialist Owen Hart), citing Hana Iqbal. The monthly fee was not stated, so it would default to 0.
- Claude suggests lead volume 3/wk for Referrals, was 2/wk, citing "It's about three a week now, it was two for ages and it's crept up" (Hana Iqbal).

### Open questions

- How long does Callum's review take? Hana does not know; ask him (Director review `work_hours` is an assumed 0.5).
- What does Quayside Vets pay per month? Hana: "that was Callum's deal".
- How often does the tracker export time out, and what does a rerun cost? Hana will not guess; Owen may know.
- Jonah Pike's FTE (the app will take 1 if nobody says).

### Timing notes

- Queueing: Hana says a report "sits in Callum's inbox a day or two". At 8 h a day that is 8 to 16 working hours of queue behind his other work. It is left to the engine and is not a `wait_hours`.
- Promise: the retainer terms say "Report within five working days of month end", which is 40 h at 8 h a day. It is a servicing SLA: set 40 h on the service's servicing link under Settings, Services (MCP cannot set it). It is in the process description, not on a step.
- Simulated cycle time: not available. `run_scenario` on the draft returned `invalid_model` ("A servicing process runs beside a pipeline; publish a pipeline process to simulate it"). Hana stated no end-to-end time.

### Ledger

| Speaker | Time | Quote | Number, in field units | Destination |
|---|---|---|---|---|
| Hana Iqbal | 00:01:16 | about an hour a client | 1 h | Pull ranking data, `work_hours` (cited) |
| Hana Iqbal | 00:01:32 | It just gets done | none | Pull ranking data, `wait_hours` 0 (assumed) |
| Hana Iqbal | 00:02:00 | call it two, three hours | 2 to 3 h, midpoint 2.5 | Write commentary, `work_hours` triangular 2 / 2.5 / 3 (cited) |
| Hana Iqbal | 00:02:00 | Two if it's a quiet month, three if something has dropped | 2, 3 h | Write commentary, `notes` |
| Hana Iqbal | 00:02:16 | I've got four half-written right now | 4 items | Write commentary, `current_wip` (cited) |
| Hana Iqbal | 00:02:56 | I honestly don't know | none | Director review, `work_hours` 0.5 (assumed) |
| Hana Iqbal | 00:03:12 | It sits in Callum's inbox a day or two | 8 to 16 h of queue | Timing note (queueing, not modelled as a wait) |
| Hana Iqbal | 00:03:38 | One in five, I'd say | 0.2 | Director review, `rework_rate` (cited), `rework_to` Write commentary |
| Hana Iqbal | 00:04:24 | A quarter of an hour, tops | 0.25 h | Send report, `work_hours` (cited) |
| Hana Iqbal | 00:04:38 | about one in ten has questions | 0.1 | Routing: Send report to Follow-up call (in `notes`; no app evidence) |
| Hana Iqbal | 00:04:52 | ninety per cent finished once it's sent | 0.9 | Routing: Send report to Report sent (in `notes`) |
| Hana Iqbal | 00:05:01 | Half an hour. Sometimes it runs over but it's half an hour in the diary. | 0.5 h | Follow-up call, `work_hours` (cited) |
| Hana Iqbal | 00:05:14 | Report within five working days of month end | 40 h | Timing note: servicing SLA in Settings |
| Hana Iqbal | 00:05:36 | she's three days a week now | 0.6 FTE | Suggestion: Priti Rao |
| Hana Iqbal | 00:05:58 | he starts on the twelfth of October | 2026-10-12 | Suggestion: Jonah Pike |
| Hana Iqbal | 00:06:17 | twenty-five hundred a month but they're on twenty-nine hundred now | 2,900 | Suggestion: Marlow Physio MRR |
| Hana Iqbal | 00:06:43 | I've no idea what they're paying | none | Open question: Quayside Vets MRR |
| Hana Iqbal | 00:07:08 | about three a week now, it was two for ages | 3 a week | Suggestion: Referrals volume |
| Hana Iqbal | 00:07:33 | It times out about once a fortnight | no cost given | Not modelled: no cost stated (open question) |
