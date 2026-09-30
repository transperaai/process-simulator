## Draft: Monthly client report (diff against live, revision 1)

Draft vs live: 1 step added (Technical check); 2 changed (Pull ranking data: work_hours 1 to 2, work_dist lognormal to triangular, work_params 1 / 2 / 3, notes, conflict false to true; Director review: rework_rate 0.2 to 0.35, conflict false to true); connections: 2 added, 1 removed, 0 changed. Matched 0 by id and 2 by name.

Canvas: `/w/<slug>/p/78abbbc5-0d8b-4f61-aa26-54215abd2e33` (draft revision 2). `created: false`: the process list still has one process. The import returned `warnings: []`; 2 conflicts and 16 assumptions to confirm. Working day: 8 h.

### Conflicts

| Step | Field | Who said what | Range used |
|---|---|---|---|
| Pull ranking data | work_hours | Hana Iqbal 1 h ("about an hour a client"); Owen Hart 3 h ("with the checking it's three hours a client") | Triangular 1 / 2 / 3 (mean 2 h). Three times apart: the app logged a perception-gap issue. |
| Director review | rework_rate | Hana Iqbal 20% ("One in five, I'd say"); Owen Hart 50% ("Callum bounces about half of them back") | Median 35%. 2.5 times apart: the app logged a perception-gap issue. |

Owen first agreed with Hana's hour and then corrected himself ("Well no, with the checking it's three hours a client"); only the correction is cited, and the step's `notes` say so. He also says Hana's one in five is right "for the ones she remembers", so the two figures may describe different samples: the person to settle it is Callum.

Routing conflicts (not tracked by the app): none this interview.

### Assumptions

Only the new step adds assumptions; every other assumption is unchanged from interview 1.

| Step | Field | Value | Reasoning |
|---|---|---|---|
| Technical check | wait_hours | 0 | The crawl runs on its own but Owen has to read it; no delay described between the two. |
| Technical check | rework_rate | 0 | Nobody says the check is redone. The tracker rerun (about twenty minutes, unmeasured) belongs to Pull ranking data. |

Cited: Technical check `work_hours` 1.5 ("About an hour and a half per client", Owen Hart, 00:02:02).

### Not overwritten

None. Someone confirmed Send report's hands-on time on the canvas (entered) before publishing; this interview says nothing about that step, so it was not listed and stays as confirmed.

### Suggestions

- Claude suggests leave 2026-12-21 to 2026-12-31 (Booked leave; back on 2 January) for Owen Hart, citing "I'm off from the twenty-first of December to the thirty-first" (Owen Hart).
- Not suggested again: Jonah Pike's start on the twelfth and Priti Rao's three days a week are already pending from interview 1 (5 suggestions were pending when this run began, so `list_suggestions` showed both).

### Open questions

- Owen plans to "front-load the December data" and pull ranks on the thirtieth of November "if they let me". That is a plan, not a fact: for Austin to confirm with Callum.
- Which is right for Callum's send-backs: Hana's one in five or Owen's about half? Ask Callum, then confirm the range or a single value on the canvas.
- Owen says a big e-commerce client is "more like four" hours of ranking data against three for the usual client. Do report times differ by client size? Not modelled: no size split exists on a step.
- Owen says the pulls are spread "over the first three or four days". Not modelled as a wait.

### Timing notes

- Queueing: unchanged from interview 1 (Hana: a day or two in Callum's inbox, 8 to 16 working hours at 8 h a day). Owen adds no queue figure.
- Promise: the five-working-day promise (40 h) still needs setting on the servicing link under Settings, Services.
- Simulated cycle time: not available. `run_scenario` on the draft returned `invalid_model` again (a servicing process runs beside a pipeline). Nobody has stated an end-to-end time.

### Ledger

| Speaker | Time | Quote | Number, in field units | Destination |
|---|---|---|---|---|
| Owen Hart | 00:00:47 | with the checking it's three hours a client | 3 h | Pull ranking data, `work_hours` (cited; conflicts with 1) |
| Owen Hart | 00:00:47 | The export itself is an hour | 1 h | Not modelled separately: part of the 3 h |
| Owen Hart | 00:01:06 | a big e-commerce client is more like four | 4 h | Open question: no per-client size split |
| Owen Hart | 00:01:20 | spread over the first three or four days | 3 to 4 days | Not modelled: calendar spread |
| Owen Hart | 00:02:02 | About an hour and a half per client | 1.5 h | Technical check, `work_hours` (cited) |
| Owen Hart | 00:03:22 | Callum bounces about half of them back | 0.5 | Director review, `rework_rate` (cited; conflicts with 0.2) |
| Owen Hart | 00:03:22 | Hana will say one in five | 0.2 | Hana's figure, already cited from interview 1 |
| Owen Hart | 00:03:53 | It's every couple of weeks | no cost | Not modelled: a rerun, not a step |
| Owen Hart | 00:04:08 | Maybe twenty minutes each time, but I haven't measured it | 0.33 h, unmeasured | Not modelled (open question in interview 1) |
| Owen Hart | 00:04:26 | He starts on the twelfth | 2026-10-12 | Already a pending suggestion (Jonah Pike) |
| Owen Hart | 00:04:36 | Three days | 0.6 FTE | Already a pending suggestion (Priti Rao) |
| Owen Hart | 00:04:52 | I'm off from the twenty-first of December to the thirty-first | 2026-12-21 to 2026-12-31 | Suggestion: Owen Hart leave |
| Owen Hart | 00:05:09 | I'll do the rank pulls on the thirtieth of November | 2026-11-30 | Open question: a plan |
