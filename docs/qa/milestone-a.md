# Milestone A: manual QA checklist

For Austin. Test on production, https://transpera-flow.vercel.app, signed in as agency admin, starting with the Northbeam workspace (`/w/northbeam`). Parent issue: #1.

Tick a box when the **Expected** result happens. If it doesn't, don't stop: write it in the Notes template at the end and carry on.

## Before you start

- Use a desktop browser (Chrome or Edge). Have a second browser or a private window ready for section 14.
- **Edits are safe until you publish.** Changing a step on the canvas opens a draft; the live model only changes when you press **Publish**. Finish each editing test with **Discard draft…** so Northbeam stays as it was.
- **Settings pages are different.** People, services, demand, clients and client-health settings save the moment you type and change the live workspace. Before you edit one, note its old value and put it back afterwards.
- Numbers come from a simulation, so they wobble a little between runs. For the seeded Northbeam, roughly: Strategist about 82% utilised, about 11–12 wins a quarter, about 5 clients churned, about 1 client at risk (from `docs/engine-versioning.md`). Anything in the same ballpark is fine; something wildly different is worth a note.
- Tags: **[2 browsers]** needs two browser windows. **[API token]** needs a personal API token (section 15). **[Claude]** needs Claude Code (or another MCP client) connected.
- Ticket numbers are in brackets, e.g. (#8), so findings can be traced back.
- **Removed in A32 (#97), so skip any older note about them:** Reports (the report builder, PDF and printable page, the `export_report` MCP tool), the Clients page (client records stay in the database and still count in the simulation, but have no screen until client groups, A55), the Scenarios and Runs sidebar items and the Runs pages (saving a run still works; the history screen, A40, lists them), and the **Track** and **Run the fix** buttons on the Issues register (A47 and A48 replace them). The Scenarios tab in the map's side panel stays until solutions (A49).
- Not in this pack: #27 (Transcript to draft, its own QA pack is coming) and #88 (Create workspaces and roles, still in progress).

---

## 1. Sign-in and workspace

- [ ] Open https://transpera-flow.vercel.app in a private window. (#4) **Expected:** you are sent to a **Sign in** page with a **Continue with Google** button and "Use your work Google account."
- [ ] Click Continue with Google and sign in with your agency admin account. (#4) **Expected:** you land on **Workspaces** with a card for **Northbeam Digital**. (Note: the ticket says magic link; the app uses Google sign-in. That is expected, but tell us if you'd prefer the ticket's wording.)
- [ ] Click the Northbeam Digital card. (#4) **Expected:** you go to `/w/northbeam` and see the process name as the page title, a key results strip, and the process map.
- [ ] Look at the top of the sidebar and its foot. (#4, #93) **Expected:** the workspace name (it opens the list of workspaces), and at the foot your name and email; that menu has **API tokens** and **Sign out**.
- [ ] Look at the sidebar. (#4, #76, #93) **Expected:** Map, Issues, People, Suggestions, Sources, then Settings and Access at the bottom. (Access shows for managers.) No Clients, Scenarios, Runs or Report items.
- [ ] Optional, only if you have a second Google account with no access to any workspace: sign in with it. (#4) **Expected:** a **No workspace yet** page naming that account and offering **Sign out**; no workspace data is visible. Sign back in as yourself afterwards.
- [ ] Click Sign out, then try to open `/w/northbeam` directly. (#4) **Expected:** you are sent back to the Sign in page. Sign in again to continue.

## 2. Canvas viewing

- [ ] Look at the map. (#4) **Expected:** every Northbeam step is there: Qualify lead, Discovery call, Audit & proposal, Client decision, Onboarding, Kickoff & strategy, SEO campaign setup, PPC campaign setup, Live, and the two end steps Won and Lost, joined by connections.
- [ ] Read the connection labels on the Client decision step. (#4) **Expected:** the branches show their shares (for example 32% on to Onboarding, 68% to Lost).
- [ ] Look at the Audit & proposal step. (#8) **Expected:** a coloured role stripe (Strategist), a queue count, and a wait badge or hands-on time. Steps with unconfirmed values also show an **Estimate** or **Assumption** marker.
- [ ] Click **Swimlanes** in the toolbar. (#8) **Expected:** steps are grouped in lanes by role, with the role name at the left of each lane. Click it again to turn lanes off.
- [ ] Scroll and drag the map background, then zoom. (#4) **Expected:** the map pans and zooms smoothly; nothing overlaps the toolbar.
- [ ] Click the process name at the left of the map's top bar (the process picker). (#76, #19, #93) **Expected:** a menu listing the pipeline process and two servicing processes (**Monthly report** and **Client check-in**, each marked "servicing"). The current one has a check mark.
- [ ] Click **Monthly report**. (#76, #19) **Expected:** the URL changes to `/w/northbeam/p/<id>`, the map switches to that process, and a **Servicing process** note says which service runs it. Click back to the pipeline.
- [ ] Open `/demo` in a new tab. (#76) **Expected:** the public demo still loads and works without signing in. (Its edits are lost on reload; that's normal.)

## 3. Editing and undo

Everything in this section lands in a draft. You'll see "Saved to draft" beside the toolbar and the Live/Draft switch appear.

- [ ] In the toolbar, leave the kind as Task and click **Add step**. (#8) **Expected:** a new step appears near the middle of the map and is selected; a draft opens ("Draft · r…" bar above the map).
- [ ] Double-click empty canvas somewhere else. (#8) **Expected:** another new Task step appears where you clicked.
- [ ] Double-click a new step, type a new name, press Enter. (#8) **Expected:** the name changes on the map; Esc instead of Enter cancels the edit.
- [ ] In the same inline editor, change **Hands-on hours** and **Wait hours**, and pick a **Role**. (#8) **Expected:** each saves on Enter ("Enter saves · Esc cancels"); the values show on the step and the key results strip re-runs within a moment.
- [ ] Drag a step to a new position, refresh the page, then switch to Draft if needed. (#8) **Expected:** the step is where you left it (positions persist).
- [ ] Drag from the edge port of one step to another. (#8) **Expected:** a new connection appears.
- [ ] Click a connection. (#8) **Expected:** a small **Edit connection** box appears with **Share** (branch probability, percent) and **Tag** (condition tag). Change Share on one branch of a decision.
- [ ] Make a decision's branches add up to something other than 100%. (#8) **Expected:** a warning on the step says the branches must sum to 100%; fix it and the warning goes.
- [ ] Drag one end of a connection onto a different step. (#8) **Expected:** the connection is rerouted. Select another connection and press Delete: it disappears.
- [ ] Right-click a step. (#8) **Expected:** a menu titled "Actions for <step name>" with: Rename and edit here, Edit in the inspector, Duplicate, Copy, Split in two, Change kind, Pin to person, Rework goes back to, Delete.
- [ ] Use **Duplicate** from the menu. (#8) **Expected:** a copy with the same values appears offset from the original (Start steps can't be duplicated: "A process has one start step.").
- [ ] In the menu, choose **Change kind**, then a different kind. (#8) **Expected:** the step changes kind (Task, Wait, Decision, Start, End); the menu warns if connections will be removed.
- [ ] In the menu, choose **Pin to person**, then a person. (#8, #6) **Expected:** the step shows "pinned" beside that person's name; **Anyone in the role** unpins it.
- [ ] In the menu, choose **Rework goes back to** and pick an earlier step. (#8) **Expected:** the step shows "Rework goes back to <step>" (needs a rework rate above 0 to matter; set one in the inspector).
- [ ] Drag a box across several steps (Shift+drag), then drag them, then press Delete. (#8) **Expected:** they move together, and Delete removes them all. Nothing is left dangling.
- [ ] Select a step, press Ctrl+C then Ctrl+V (Cmd on Mac). (#8) **Expected:** a pasted copy lands slightly offset; pasting again lands further along.
- [ ] Click a step. (#8) **Expected:** the right side switches to a **Step** inspector with: Name, Kind, Role, Pinned person, Hands-on time, Wait after, Rework rate, Rework goes back to, SLA, Current WIP, Tool, Notes.
- [ ] In the inspector, change Hands-on time's **Distribution** through all three choices: "Always the same (constant)", "Range (triangular)", "Varies (lognormal)". (#8) **Expected:** the fields change to match (Mean; Min / Most likely / Max; Mean and Variability), and the results re-run after each change.
- [ ] On an end step, set **Outcome** to Won, Lost or Done in the inspector. (#12) **Expected:** the outcome shows on the step and in the Change kind menu (for example "End (Won)").
- [ ] Press the **Undo** button (or Ctrl+Z) several times, then **Redo** (Ctrl+Y). (#8) **Expected:** every canvas and inspector edit reverses one at a time and comes back in order. Hover over Undo to see what it will undo.
- [ ] Click **Keys** in the toolbar. (#8) **Expected:** a list of keyboard shortcuts.
- [ ] Keyboard only: Tab to a step, press Enter to edit, Shift+F10 for the menu, Esc to close. (#8) **Expected:** everything can be reached and operated without the mouse.
- [ ] Type a Current WIP number on a step in the inspector (for example 3 on Audit & proposal). (#11) **Expected:** it saves; the small line under the key results changes from "warm-up" wording to say the run started from the entered WIP.
- [ ] Finish: click **Discard draft…** and confirm. (#9) **Expected:** the map returns to how it was.

## 4. Drafts and publish

- [ ] Change one number on a step (for example Audit & proposal hands-on time). (#9) **Expected:** a draft opens; the bar shows **Live · r…** and **Draft · r…** buttons and text like "1 change against live".
- [ ] Click **Live**. (#9) **Expected:** the map shows the original live model, unchanged, with the text "The live model, as simulation and forecasts use it."
- [ ] Click **Draft** again and look at the map and the list of changes. (#9) **Expected:** changed values show old → new, new steps are dashed, removed steps are struck through, and a **Changes in this draft** list names every change.
- [ ] Add a step, delete a step, and change a value, then look at the list. (#9) **Expected:** each change is listed once ("New step", "Removed step", the field that changed).
- [ ] In that list, discard one change only (Discard, Restore or Revert). (#9) **Expected:** just that change goes; the others stay.
- [ ] Click **Compare with live**. (#9) **Expected:** a **Draft vs live** table appears with both sets of key results and the differences.
- [ ] Click **Publish…**. (#9) **Expected:** a confirmation appears. If any step still holds unconfirmed estimates it says so, lists them ("Review <step>"), and offers **Publish, accepting N estimates**; otherwise **Publish revision N**. (Northbeam's sample steps are estimates, so expect the first.)
- [ ] Click **Cancel** rather than publishing, unless you want to make a real change. (#9) **Expected:** nothing is published; live is unchanged. If you do publish, the revision number goes up (**Live · r…**) and the change is in the audit log.
- [ ] Click **Discard draft…**. (#9) **Expected:** a warning "This can't be undone" with **Discard draft** and **Keep editing**; discarding returns to live.
- [ ] In the process picker, choose **New servicing process…**, type a name (for example "QA test"), click **Create**. (#76, #93) **Expected:** the new process opens; it is marked "servicing" and "not published" in the picker, shows **Not published yet · Draft · r1** and "This process has never been published…".
- [ ] In that new process, add a step, then click **Publish…** and publish. (#76, #9) **Expected:** it becomes live (r1) and the "not published" tag goes. This test process stays in Northbeam afterwards, so list it in your Notes and we'll remove it.

## 5. Simulation KPIs and ranges

- [ ] Look at the key results strip on the live Northbeam page. (#4, #7, #12) **Expected:** tiles for Wins, Lost, Cycle time, Bottleneck, Overtime, New MRR, Billed, LTV added, Lost revenue, Overtime cost, Clients at risk and Churned.
- [ ] Read the **Wins** tile. (#7) **Expected:** a headline average with a range underneath, for example "10.4" and "range 7–14", in aligned digits.
- [ ] Read the **Cycle time** tile. (#7) **Expected:** the mean in days, with P50 and P90 underneath.
- [ ] Read the **Bottleneck** tile. (#4) **Expected:** the role name (Strategist), its utilisation and a range, red if above 85%.
- [ ] Read the line under the tiles. (#7, #11) **Expected:** "Average of N replications; ranges are the 10th–90th percentile", a time in ms, and whether the run started from entered WIP or an automatic warm-up.
- [ ] Hover over each money tile (New MRR, Billed, LTV added, Lost revenue, Overtime cost). (#12) **Expected:** a definition appears. Money shows in the workspace currency with thousands separators; percentages and days look consistent from tile to tile.
- [ ] In the right-hand panel, look at **Bottleneck**. (#26) **Expected:** the top constraint with evidence, and a **Shadow price · +1 Strategist** box that briefly says "Running N extra replications…" and then shows a number of "completions / quarter" with a range.
- [ ] In **Utilisation**, switch between **roles** and **people**. (#6, #7) **Expected:** a bar per role, then a bar per named person (11 people); a tick marks the 85% ceiling; a dark line shows the 10th–90th percentile range; grey shows client work.

## 6. Playback

- [ ] Find the **Playback** bar at the foot of the map and press **Play**. (#14) **Expected:** small tokens travel along the connections from step to step, including curved ones and connections that go back.
- [ ] Watch a busy step such as Audit & proposal. (#14) **Expected:** the queue count on it grows and shrinks as tokens arrive and leave.
- [ ] Watch the bottleneck step. (#14) **Expected:** it pulses while playback plays.
- [ ] Change the speed (1 day/s, 2 days/s, 1 week/s, 2 weeks/s). (#14) **Expected:** tokens speed up or slow down accordingly.
- [ ] Drag the time slider to the middle and to the end, then back to the start. (#14) **Expected:** the map shows the right picture at each time and the clock reads the simulated week and day. At the end the button says **Replay**.
- [ ] Press Pause, then click **Exit playback**. (#14) **Expected:** it pauses on the current frame; Exit clears the tokens and queue counts.
- [ ] Read "Run 1 of N" on the bar. (#14) **Expected:** it says playback shows one simulated run while the tiles average all of them.
- [ ] Does it feel smooth (no stutter) while playing? (#14) **Expected:** yes, on a normal laptop.
- [ ] Optional: turn on "Reduce motion" in your computer's accessibility settings, reload, and press Play. (#14) **Expected:** no moving tokens; the map shows still queue counts at each moment instead.

## 7. Levers, scenarios and compare

- [ ] Scroll below the map to **Levers**. (#15) **Expected:** groups **Demand**, **People**, **Process** (relative to today, ±%) and **Finances**, with sliders or number fields, and "Every change re-runs the simulation."
- [ ] Move one lever (for example More leads per week). (#15) **Expected:** the text changes to "Re-ran in N ms" and the **Compare: baseline vs scenario** area fills in.
- [ ] Read the compare headline. (#15) **Expected:** a plain-English sentence with a range, for example "…adds avg 2.1 wins/quarter (range 1.4–2.9)", plus a table of key results for baseline and scenario with differences.
- [ ] Look at "Utilisation, side by side" and switch **Role** and **Person**. (#15) **Expected:** bars for baseline and scenario next to each other, red above the 85% tick.
- [ ] Click **Reset N lever(s)**. (#15) **Expected:** levers return to today's values and the compare area goes back to "Move a lever or apply a saved scenario…".
- [ ] Look at the **Scenarios** list. (#15) **Expected:** four saved scenarios: **Hire a strategist**, **Automate proposals**, **More leads**, **Downturn**, each with a description and what it changes.
- [ ] Click **Apply** on "Hire a strategist". (#15) **Expected:** it gets a "1" badge and the compare area shows the effect (Strategist utilisation drops, wins rise).
- [ ] Also apply "More leads". (#15) **Expected:** it gets a "2" badge and the comparison uses both stacked, in that order; **Remove all (2)** clears them.
- [ ] Move a lever, type a name and click **Save N lever change(s)**. (#15) **Expected:** a new scenario appears in the list, already applied.
- [ ] On your new scenario, click **Duplicate**, then **Delete** on the copy. (#15) **Expected:** a copy appears (named "… copy"), and deleting asks for confirmation before it goes. Delete your test scenario too.
- [ ] Read the headline for a scenario, and compare it with the tiles. (#15) **Expected:** the wording is templated (the same shape every time) and the numbers match the table.
- [ ] Break a scenario on purpose: open the Audit & proposal menu, choose **Split in two**. (#16) **Expected:** the draft bar says "publishing breaks 1 saved scenario"; in **Scenarios**, "Automate proposals" shows a red **Needs attention** badge and "Left out of the comparison until this change is re-pointed", naming the step.
- [ ] Click the **Point at …** button suggested under that scenario. (#16) **Expected:** the badge clears and the scenario can be applied again.
- [ ] Open the **Issues** tab on the right while a scenario is broken. (#16, #17) **Expected:** a broken-scenario issue is listed, and it resolves itself once you re-point.
- [ ] Finish: **Discard draft…** to remove the split. (#16) **Expected:** back to live with nothing broken.

## 8. Demand and services

Settings save as you type and change live data. Note each old value and restore it.

- [ ] Open **Settings** in the sidebar. (#6, #93) **Expected:** a **Workspace settings** page with sections in this order: **Simulation**, **Services**, **Client health**, **Demand**, **People**. (**People** in the sidebar opens the last of these.)
- [ ] Simulation: read **Availability floor** and **Overtime cap**. (#6, #18) **Expected:** each shows a value or "(default)" placeholder and a one-line explanation. Change the availability floor (for example to 10), then put it back; the tiles re-run on the process page.
- [ ] People: look at the list of 11 people. (#6) **Expected:** names such as Priya Shah, Maya Collins and Rosa Diaz, each with their role, status and details (Name, Email, Status, FTE, Capacity, Cost rate, Start date, End date, Notes, Roles, Skills, Leave).
- [ ] Add a person with **Add person** (name and role). (#6) **Expected:** they appear in the list and in the Utilisation "people" view after the next run.
- [ ] Open the new person, tick a skill (a step they can do) and add a **Leave** period. (#6) **Expected:** both save. (With leave booked, they do no work in that window and colleagues pick up the queue.)
- [ ] Switch the new person's Status to **Inactive: left out of simulations**. (#6) **Expected:** they show "Inactive" and vanish from the Utilisation bars. Leave them inactive or remove them.
- [ ] Services: look at the list. (#12) **Expected:** **SEO retainer** and **PPC management** with pricing model, price, margin, expected tenure, base churn, churn sensitivity, mix share, entry, status and path tags.
- [ ] Change the SEO price, then return to the process page. (#12) **Expected:** New MRR, Billed and LTV added change; restore the price afterwards.
- [ ] Add a service with **Add service** and set it Inactive. (#12) **Expected:** it saves and doesn't affect the results while inactive.
- [ ] Demand: read the **Lead sources** list. (#13) **Expected:** each source has Leads a week and "Become qualified" (%), and a "Qualified a week" total. A provenance label (Estimated, Entered or Measured) sits beside each value.
- [ ] Change one lead source's volume and check the tiles. (#13) **Expected:** Wins and Lost move in the same direction. Restore the value.
- [ ] Demand: open **Seasonality** and change one month. (#13) **Expected:** each month has a multiplier, and **Reset to flat (every month 1)** restores it.
- [ ] Demand: set **Monthly growth in leads**. (#13) **Expected:** it saves; results shift slightly if the horizon covers the growth. Set it back.
- [ ] Compare Overtime and utilisation before and after setting **Overtime cap** to 0 (then restore it). (#18) **Expected:** with no cap, the **Overtime** tile reads "none allowed (cap 0%)", people over their week show utilisation above 100%, and a critical capacity issue may appear in Issues.
- [ ] Read the **Overtime** and **Overtime cost** tiles with the cap restored. (#18) **Expected:** hours and money with ranges.

## 9. Servicing and health

- [ ] In the process picker, open **Monthly report** and **Client check-in**. (#19, #93) **Expected:** each is a servicing process built on the same canvas; the **Servicing process** note explains which service uses it and how often.
- [ ] In **Settings → Services**, look for the servicing links. (#19, #93) **Expected:** a "Servicing processes" area per service with **How often, per client** and **On time within**, and a **Link** button; "None: each client needs the fallback load below" for services with no link.
- [ ] Read **Ongoing load per client (hours a month, by role)** on a service. (#19, #18) **Expected:** editable hours per role; blank means none.
- [ ] Read the **Client health** settings. (#19) **Expected:** rules for how on-time, late and missed work move health, each with an "(estimated)" placeholder and an explanation of the churn formula.
- [ ] Raise the weekly leads on a lever by a lot. (#19) **Expected:** more late or missed touchpoints, lower health, more churn and more clients at risk (the busier pipeline squeezes servicing).
- [ ] In Issues, look for a churn-risk issue. (#19) **Expected:** if a client's simulated health falls below 50, a churn-risk item appears in the register (source: Detected).

## 10. Robustness

- [ ] Apply "Hire a strategist" so the compare area is showing, then find **Robustness** at its foot. (#20) **Expected:** a **Check robustness** button and a line saying how many estimated inputs it will vary by 25% and "Takes 10–30 s".
- [ ] Click **Check robustness**. (#20) **Expected:** a progress bar reading "Stage 1 of 2: screening every input", then "Stage 2 of 2: refining the most sensitive", with a **Cancel** option.
- [ ] Time it. (#20) **Expected:** it finishes in roughly 10–30 seconds on your laptop.
- [ ] Read the verdict. (#20) **Expected:** plain-English sentences such as "Strategist is the bottleneck in N% of cases; the hire adds MRR in N% of cases".
- [ ] Read **Most sensitive inputs: measure these next**. (#20, #79) **Expected:** a list of inputs with the effect on the gain when each is lower or higher. Client-health rules or churn sensitivity may show up here if they matter; not seeing them is not a fault.
- [ ] Click **Check again** straight away. (#20) **Expected:** "Shown from this session's earlier check; nothing was re-run." and it returns almost instantly.
- [ ] Start a check and press **Cancel**. (#20) **Expected:** "Cancelled. Finished runs are kept, so checking again picks up where this stopped."

## 11. Issues register

- [ ] Open **Issues**. (#17) **Expected:** **Issues register** with a count line ("N open issues · N critical · N serious") and filters for Process, Person, Severity, Source and Status.
- [ ] Look at the three seeded items. (#17) **Expected:** "Every proposal is built by hand", "Only Maya Collins can do Audit & proposal" (Promoted) and "Lead scoring could skip unqualified discovery calls", each with severity, evidence and where it applies.
- [ ] Look for detected issues (source: Detected). (#17) **Expected:** items the latest run found, such as a role over 85%, a queue growing without bound, a long wait or a rework or SLA problem; "Checking the latest run…" shows briefly first.
- [ ] Log a new issue: fill **Title**, Severity, Step, Person, Owner, Fix (scenario), Evidence, and submit. (#17) **Expected:** it appears in the register with all those fields.
- [ ] Open **Edit** on it, change Status, Severity, Type, Owner and Evidence. (#17) **Expected:** each saves as you go; **Done editing** closes the form.
- [ ] Use each filter (Process, Person, Severity, Source, Status). (#17) **Expected:** the list narrows to match; "No issues match these filters." appears when nothing does.
- [ ] On the process page, open the panel beside the map (the panel button at the right of the top bar), then **Insights → Issues**. (#17, #93) **Expected:** the tab shows the open count ("Issues · N") and the same list; **Open the full register →** goes to the full page.
- [ ] Look at Audit & proposal on the map. (#17) **Expected:** a small badge for its issues; clicking it opens that step's issues in the tab.
- [ ] Delete or close your test issue. (#17) **Expected:** it disappears or moves to closed.

## 12. Sources and evidence

- [ ] Open **Sources**. (#21) **Expected:** two sample sources, **Strategy walkthrough** (transcript) and **Sales team notes** (notes), each showing "Cited by N values" and **Details and edit**.
- [ ] Open **Details and edit** on Strategy walkthrough. (#21) **Expected:** Title, Kind, Speakers, Date, link and the full transcript, plus a list of values that cite it, each with its quote.
- [ ] Add a source with **Add a source**: kind, title, speakers, date and some notes, then **Add source**. (#21) **Expected:** it appears in the list as "Not cited yet". Delete it afterwards (it asks first).
- [ ] On the map, look at Audit & proposal. (#21) **Expected:** an estimate or assumption marker; hovering shows the quote behind it.
- [ ] Click Audit & proposal and scroll to **Evidence** in the inspector. (#21) **Expected:** cited values (hands-on time, rework rate) each with the quote, speaker, time and a status of Estimated, Entered or Measured.
- [ ] In the inspector, click **Cite a source…** and cite the finance colleague's higher estimate: Value **Hands-on time**, Source **Strategy walkthrough**, Speaker **Rosa Diaz**, Where **00:16:40**, hours **12**, Quote "From the time logs it looks more like twelve hours". (#21) **Expected:** the value becomes a **Conflict** ("Sources disagree: Maya Collins 6 h vs Rosa Diaz 12 h. Simulated as a range from 6 h to 12 h").
- [ ] Look at the draft's checklist. (#21) **Expected:** a **To confirm (…)** panel lists conflicts first, then assumptions, each with value, reasoning and quotes.
- [ ] While the conflict exists, apply "Hire a strategist" and click **Check robustness** (see section 10). (#21) **Expected:** it uses the real range from the conflict instead of plus or minus 25%; if the answer flips inside it, it says the answer depends on whose estimate is right and what to measure (this may not flip, which is fine).
- [ ] Look in Issues for a "perception gap". (#21) **Expected:** because the two estimates differ by 2× or more, a perception-gap issue exists (it may need a refresh).
- [ ] In the checklist, click **Confirm** on an assumption. (#21) **Expected:** it leaves the list and its status becomes Entered.
- [ ] On the conflict, click **Keep the range** or one of the **Use …** buttons. (#21) **Expected:** the conflict clears and the step follows your choice.
- [ ] Click **Publish…** while a conflict is unresolved. (#21, #9) **Expected:** the confirmation counts the unresolved conflicts with the estimates before you can publish.
- [ ] Finish: **Discard draft…**. (#21) **Expected:** live returns to its original evidence.

## 13. Suggestions

- [ ] Open **Suggestions** with nothing pending. (#25) **Expected:** "Nothing waiting for review. When Claude changes people, clients, services, demand or company settings over MCP, its suggestions appear here." and the link shows no number badge.
- [ ] In **Settings**, change a person's cost rate, then open **Recent changes to the company model** on the Suggestions page. (#25, #93) **Expected:** your edit applied immediately and is logged with your name and the time.
- [ ] [Claude] After section 15 has created suggestions, open **Suggestions**. (#25) **Expected:** each reads like "Claude suggests lead volume 15/wk, was 12" with old and new values, reasoning and any cited source, in tabs **Pending**, **Accepted**, **Rejected**, **All**, with counts.
- [ ] [Claude] Click **Accept** on one. (#25) **Expected:** the value now shows in settings, marked with the source's provenance; if no source was cited it is recorded as an assumption to confirm.
- [ ] [Claude] Click **Reject** on another and confirm. (#25) **Expected:** it moves to Rejected and the live value is untouched.
- [ ] [Claude] Tick several, use **Select all**, then **Accept selected** or **Reject selected**. (#25) **Expected:** all chosen suggestions are handled in one go.
- [ ] [Claude] Look at **Recent changes to the company model**. (#25) **Expected:** accepted suggestions appear as "Claude (API token of …) · accepted suggestion".

## 14. Realtime (two browsers)

Use two windows: Chrome plus a private window, or two browsers. Sign in to both. Same account is fine (the second shows as "You, in another tab"); a second agency account is better. Open the same process in both.

- [ ] [2 browsers] Look at the bar above the map in window A. (#10) **Expected:** "Live updates" with a green dot, and window B's user named ("<name> is viewing <process> (live)" or "(the draft)").
- [ ] [2 browsers] Close window B. (#10) **Expected:** within a few seconds window A says nobody else is here.
- [ ] [2 browsers] In window A, change a step's hands-on time. Watch window B without reloading. (#10) **Expected:** within a few seconds B shows the new value, and its activity line says who changed what ("… · just now").
- [ ] [2 browsers] Change two different fields of the same step, one in each window. (#10) **Expected:** both changes are kept; nothing is lost.
- [ ] [2 browsers] Change the same field of the same step in both windows (type a new value in each, save B second). (#10) **Expected:** the window that saved second gets a prompt naming the field, both values and who changed it, with **keep mine** and **keep theirs**.
- [ ] [2 browsers] Choose one, then reload both windows. (#10) **Expected:** the chosen value is the one that persisted, in both.
- [ ] [2 browsers] Turn off your Wi-Fi briefly in window A. (#10) **Expected:** the bar says "Offline: changes by others show when you reconnect"; when you reconnect, missed changes appear.
- [ ] [2 browsers] Discard the draft when finished. (#10) **Expected:** both windows return to live.
- [ ] Fallback for one browser: open `/demo` and tick **Simulate a colleague (Tom)**. (#10) **Expected:** "Tom is viewing …" appears and his changes and same-field conflicts show up the same way. This shows the design only; it doesn't replace the real test.

## 15. MCP (needs an API token and Claude)

- [ ] Open the menu at the foot of the sidebar and click **API tokens**. (#23, #93) **Expected:** an **API tokens** page listing tokens with Created, Last used and Status.
- [ ] Type a name (for example "Claude Code on my laptop") and click **Create token**. (#23) **Expected:** the token is shown once, with a ready-made `claude mcp add --transport http transpera-flow …` command. Copy it now; it can't be shown again. Never paste the token into a chat or an issue.
- [ ] [API token] Run that command in a terminal, then start Claude Code and ask it to list the transpera-flow tools. (#23) **Expected:** the five starter tools, list_workspaces, set_active_workspace, get_workspace_summary, get_process and run_scenario, plus the later ones below.
- [ ] [API token][Claude] Ask: "List my workspaces, then set Northbeam active and summarise it." (#23) **Expected:** Northbeam is listed and summarised (roles, people).
- [ ] [API token][Claude] Ask: "Run the baseline scenario for Northbeam." (#23) **Expected:** a summary with averages and ranges, close to what the browser tiles show (small differences can come from settings such as the seed or replication count).
- [ ] [API token][Claude] Ask it to build a small process: "Create a draft process called QA test with three steps and connect them." (#24) **Expected:** it works and reports any defaulted values as assumptions. Nothing goes live.
- [ ] In the browser, open that process from the process picker. (#24, #76, #93) **Expected:** an entry marked "not published"; it opens in Draft view with the steps Claude added, and assumption markers on defaulted values.
- [ ] [API token][Claude] Ask it to publish without accepting estimates. (#24) **Expected:** it refuses because of unresolved assumptions unless it says it accepts them as estimates.
- [ ] [API token][Claude] Ask it to update a step by an ambiguous name. (#24) **Expected:** it comes back with candidates rather than picking one.
- [ ] [API token][Claude] Ask it to import a process over an existing one. (#24) **Expected:** it returns a diff against live and keeps values you already entered, flagging conflicts instead of overwriting.
- [ ] [API token][Claude] Ask it to change lead volume, add a person and add a client. (#25) **Expected:** each becomes a pending suggestion; nothing changes in settings until you accept (see section 13).
- [ ] [API token][Claude] Ask it to save a scenario and compare two. (#26) **Expected:** the scenario appears in the app's **Scenarios** list, and the comparison's headline and numbers match the app's compare area.
- [ ] [API token][Claude] Ask: "What is the top bottleneck and its shadow price?" (#26) **Expected:** Strategist, with a completions-per-quarter figure matching the app's **Shadow price** box.
- [ ] [API token][Claude] Ask it to check robustness. (#26) **Expected:** a verdict, or a partial result clearly marked as partial.
- [ ] [API token][Claude] Ask it to log an issue on a step by name. (#26) **Expected:** it appears in the Issues register linked to that step.
- [ ] Back on **API tokens**, look at the token you used. (#23) **Expected:** **Last used** has updated.
- [ ] Click **Revoke** on the token, then ask Claude to list workspaces again. (#23) **Expected:** status "Revoked <date>" and Claude can no longer connect.
- [ ] Look at the audit log of company changes. (#24, #25) **Expected:** Claude's changes read "Claude (API token of …)".

## 16. Narration

Reports and the PDF export were removed in A32 (see "Removed in A32" above). "Explain this run" is still built (`POST /api/narrate` with `{target: "run", runId}`), but its only screen was the saved run page, which is gone; the history screen (A40) brings it back. Nothing to tick here until then.

## 17. Privacy

- [ ] Open `/privacy` in a private window (no sign-in). (#29) **Expected:** the page loads publicly with "Last updated 30 September 2026" and sections What we collect, How we use it, Who can see it, Service providers, Your client data, Google user data, Keeping and deleting data, Contact.
- [ ] Read the **Anthropic** line under **Service providers**. (#29) **Expected:** it says Anthropic drafts a summary or explains a saved run only when someone asks; it receives figures and the names of the process, steps, roles and scenarios; staff and client names are swapped for labels; it doesn't train on it. Decide whether that wording is what you want (see below).
- [ ] Check the contact link. (#29) **Expected:** `austin@transpera.ai` opens an email.
- [ ] Check that signed-in pages can't be reached signed out (try `/w/northbeam/issues`, `/w/northbeam/settings` in a private window). (#4) **Expected:** you are sent to Sign in; only `/login`, `/demo`, `/privacy` and `/auth` are public.

---

## Decisions to confirm

These are product calls, not bugs. Tell us what you want.

1. **The lost-revenue definition.** Where: the **Lost revenue** tile in the key results strip on `/w/northbeam` (hover for the definition), and in the report's key results. Today it means: for each lost lead, what it would have been worth if won (price times expected tenure for a retainer). It counts every lost lead, including ones that were never a good fit. Is that the number you want to show clients? (PRD section 13.)
2. **The starter scenarios.** Where: **Scenarios** list below the map on `/w/northbeam`. Northbeam has four: Hire a strategist, Automate proposals (hands-on time down 60% on audits), More leads (+25%), Downturn (30% fewer leads, churn up by half). A brand-new workspace gets generic versions ("Hire into the busiest role", "Automate the heaviest step", plus the same More leads and Downturn). Are these the right four, and are the 60%, 25% and 30% assumptions fair?
3. **Whether Larkspur should be seeded in production.** Larkspur Creative is the second, messier sample agency (18 clients, overload, overtime, churn). Where: read-only at `/demo/larkspur` (public, no sign-in). It is **not** a workspace in production, so it won't appear under **Workspaces**. Do you want it as a real second workspace for demos, or kept out of production?
4. **The `/privacy` wording about narration.** Where: `/privacy`, **Service providers**, the **Anthropic** bullet. It says Anthropic receives figures plus the names of the process, steps, roles and scenarios, that staff and client names are replaced with labels, and that Anthropic doesn't train models on it. Confirm the wording is acceptable, and that it is what you want to tell clients. (The consent screen for Google sign-in also points at this page.)

## Notes

Post your findings as **one comment on #1** (https://github.com/transperaai/transpera-flow/issues/1), or send them to Claude in chat. Copy the block below once per problem.

```
Section and item: (for example "7. Levers, scenarios and compare, split Audit & proposal")
Ticket: (for example #16)
What I did:
What I expected:
What happened instead:
Where (page and URL):
Screenshot: (attach or paste)
How bad: blocker / annoying / polish
```

Also useful, as one list at the end: anything that felt confusing even though it worked, and anything you'd change about the flow. Those go into the polish and flow review.

---

## Covered by automated tests

Left out of the steps above because only a developer can check them, or because they are automatic.

- #4: RLS test that a user with no membership sees nothing; local seed script; engine unit tests in Node; CI on every push; preview deploys per branch.
- #5: the whole ticket (queueing-theory models, separate random streams, binary-heap event queue, Node and browser determinism, behaviour checks).
- #6: tables and RLS; dispatch to named people, pinned steps and leave (engine tests).
- #7: engine output includes mean, P10 and P90 for every metric; one shared number formatter.
- #8: step IDs unchanged after edits and reloads; 40 ms debounce with cancelling of stale runs; per-field saves with version check (its user-visible side is section 14).
- #9: editing creates a draft and leaves live unchanged; runs of the live model ignore drafts.
- #10: concurrent edits to different fields both persist; Realtime usage within the Supabase Pro limits (documented).
- #11: runs with WIP start with those items; warm-up excluded from every metric; warm-up removes the empty-start bias.
- #12: tables and RLS; entity tagging and routing by service; revenue booked exactly once per won entity; §13 definitions.
- #13: arrival rate equals volume times conversion split by mix; seasonality changes counts by month; seed reproduces the previous arrival rate.
- #14: 60 fps on a mid-range laptop is checked only by eye (see the "smooth" item).
- #15: patches stored as `{path, op, value}`; a multiply patch survives re-measurement; headline text comes from templates only; new workspaces get four seeded scenarios; re-run performance targets.
- #16: deleting or splitting a target marks the scenario `needs_attention`; running a broken scenario returns an error; the broken-scenario issue resolves on re-pointing.
- #17: detected keys stable across runs; each detector has a triggering test model; promotion isn't duplicated on the next run.
- #18: tables and RLS; fallback load recomputed as clients are won or churn; overtime, cap and critical capacity issue; reported ongoing utilisation matches the availability used.
- #19: `processes.kind` and `service_servicing`; servicing entities per recurrence; assignment with leave fallback; health and churn formulas; the behaviour test.
- #20: benchmark for a 40-step, 25-person model; verdict maths; cache reuse test; the time-capped Node variant.
- #21: conflicted values use triangular ranges in the engine and robustness; "conclusion flips" reporting; the perception-gap trigger at 2× or more.
- #22: the whole ticket (second golden agency seed, snapshot tests, engine version bump command, re-baselined Northbeam values).
- #23: only the token's hash is stored; RLS through MCP; no code path uses the service-role key; run_scenario matches the browser for the same model and seed; per-token rate limiting.
- #24: every write goes to a draft revision; import diff and stable IDs; entered values not overwritten; every MCP write audit-logged as `mcp`.
- #25: each MCP tool creates a suggestion and changes no live data.
- #26: all tools return `{ok, data, assumptions[]}`; compare_scenarios matches the app's table and headline; log_issue linking by ID or name.
- #28: removed in A32 (reports and the PDF export are gone; the database tables stay).
- #29: the number validator (adversarial cases), single retry then template fallback, `narrations.validated` and `fallback` recorded, the API key never reaches the client, the latest Claude model per the repo's guidance.
- #76: `/w/[slug]` and `/demo` keep their existing behaviour.
- #79: new patch paths accepted by both parsers (parity test); robustness perturbs only estimated health rules and churn sensitivity, never entered or measured ones.

Excluded from this pack: **#27** (Transcript to draft, end to end) has its own QA pack coming, and **#88** (Create workspaces and roles from the app and MCP) is still in progress.
