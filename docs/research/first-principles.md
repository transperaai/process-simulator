# First principles per process: sources and a proposed flow

Research note, 1 Oct 2026. Question: how should a consultant capture "first principles" for each business process, so
the app's AI analysis can judge the process against them?

How to read this note:

- **Verified** means I read the words in the primary source myself (link given).
- **Not verified from primary** means I could only reach a secondary source. The wording may be a paraphrase. Treat it
  as such before quoting it to a client.

Part A covers the sources. Part B proposes the flow. Part C lists what I could not verify.

---

## Part A. Sources

### A1. Musk on first-principles reasoning

**TED 2013 (verified).** Musk, interviewed by Chris Anderson, TED2013, February 2013. Transcript on ted.com, at about
19:21–19:45 (cue times 1161795–1183549 ms in the page's transcript data):

> "Well, I do think there's a good framework for thinking. It is physics. You know, the sort of first principles
> reasoning. Generally I think there are -- what I mean by that is, boil things down to their fundamental truths and
> reason up from there, as opposed to reasoning by analogy. Through most of our life, we get through life by reasoning
> by analogy, which essentially means copying what other people do with slight variations. And you have to do that.
> Otherwise, mentally, you wouldn't be able to get through the day. But when you want to do something new, you have to
> apply the physics approach."

Source: [TED, "The mind behind Tesla, SpaceX, SolarCity", transcript](https://www.ted.com/talks/elon_musk_the_mind_behind_tesla_spacex_solarcity/transcript).

Two points matter for us:

- First principles means separating **fundamental truths** from **things copied from others** (analogy).
- Musk himself says you cannot do this for everything. Use it where you want to change something. That argues for a
  short form, filled in per process, not per step.

**Kevin Rose, "Foundation" episode 20, 2012 (not verified from primary).** The episode aired 8 Sep 2012 and was shot at
the Tesla factory ([Wikipedia, Kevin Rose](https://en.wikipedia.org/wiki/Kevin_Rose)). The often-quoted battery example
comes from it. I could not get the video transcript (YouTube blocks this environment). The wording below is as quoted
in secondary sources ([CNBC, 28 Feb 2020](https://www.cnbc.com/2020/02/28/billionaire-elon-musk-this-is-a-powerful-way-of-thinking-but-hard-to-do-how-it-works.html);
the same text is in the book *Super Thinking*):

> "Somebody could say, 'Battery packs are really expensive, and that's just the way they will always be. Historically,
> it has cost $600 per kilowatt hour.' ... What are the material constituents of the batteries? What is the spot
> market value of the material constituents? It has carbon, nickel, aluminum, and some polymers for separation, and a
> steel can. Break that down on a materials basis, if we bought that on a London Metal Exchange, what would each of
> these things cost? ... It's like $80 per kilowatt-hour."

The pattern is useful for processes: **"it has always taken X" is a historical figure, not a truth. Rebuild the figure
from its parts.** In our app the parts are the step times, waits and rework rates that the engine already holds.

### A2. Musk's five-step "algorithm"

**Everyday Astronaut, "Starbase Tour with Elon Musk [Part 1 // Summer 2021]" (not verified from primary).** Video:
[youtu.be/t705r8ICkRw](https://youtu.be/t705r8ICkRw). The five steps run from about **13:25–13:32 to 28:24**
(timestamps from [CleanTechnica, 16 Aug 2021](https://cleantechnica.com/2021/08/16/elon-musk-reveals-his-5-step-engineering-protocol/)
and [Space Explored, 4 Aug 2021](https://spaceexplored.com/2021/08/04/watch-a-tour-of-spacexs-starbase-facility-with-everyday-astronaut-part-1-of-3/)).
I could not pull the transcript. CleanTechnica's quotes read like a light tidy-up of speech:

1. "Make the requirements less dumb. The requirements are definitely dumb; it does not matter who gave them to you."
   Requirements from a smart person are the most dangerous, because you question them less.
2. "Try very hard to delete the part or process. If parts are not being added back into the design at least 10% of
   the time, [it means that] not enough parts are being deleted."
3. "Simplify and optimize the design. This is the most common error of a smart engineer — to optimize something that
   should simply not exist."
4. "Accelerate cycle time. You're moving too slowly, go faster! But don't go faster until you've worked on the other
   three things first."
5. "Automate." He adds that in-process testing can be removed once the problems are diagnosed.

On order: "I have personally made the mistake of going backwards on all five steps multiple times. In making Tesla's
Model 3, I literally automated, accelerated, simplified and then deleted."
([CleanTechnica](https://cleantechnica.com/2021/08/16/elon-musk-reveals-his-5-step-engineering-protocol/)).

**Walter Isaacson, *Elon Musk* (Simon & Schuster, Sept 2023) (not verified from primary).** Isaacson calls the five
steps "the algorithm" and ties them to the 2017–18 "production hell" at the Nevada and Fremont factories
([Fortune, 13 Sep 2023](https://fortune.com/2023/09/13/elon-musk-management-manufacturing-philosophy-the-algorithm)).
I do not have the book. The wording below is as quoted by
[Geekway](https://geekway.substack.com/p/an-ultimate-guide-to-elon-musks-algorithm), and matches other excerpts:

1. **Question every requirement.** "Each should come with the name of the person who made it. You should never accept
   that a requirement came from a department, such as from 'the legal department' or 'the safety department.' You need
   to know the name of the real person who made that requirement."
2. **Delete any part or process you can.** "You may have to add them back later. In fact, if you do not end up adding
   back at least 10% of them, then you didn't delete enough."
3. **Simplify and optimize.** "This should come after step two. A common mistake is to simplify and optimize a part or
   a process that should not exist."
4. **Accelerate cycle time.** "Every process can be speeded up. But only do this after you have followed the first
   three steps."
5. **Automate.** "That comes last." Musk's mistake in Nevada and Fremont was to start by automating every step.

The chapter is reported as "The Algorithm". I could not confirm the chapter number or page.

Takeaways for the app:

- The **named owner** rule is concrete and checkable: a requirement owned by "Finance" fails, one owned by "Priya
  (Finance lead)" passes.
- The **order** is checkable: a proposal to automate or speed up a step that is also a delete candidate is out of
  order.
- The **10% add-back** rule is a heuristic, not a law. Use it as a nudge ("you deleted nothing; are you sure?"), not as
  a gate.

### A3. Aristotle: what a "first principle" is (verified)

- *Metaphysics* V.1 (1013a17–19), trans. W. D. Ross: "It is common, then, to all beginnings to be the first point
  from which a thing either is or comes to be or is known." ([MIT Classics](https://classics.mit.edu/Aristotle/metaphysics.5.v.html))
- *Posterior Analytics* I.2 (71b19–22), trans. G. R. G. Mure: "the premisses of demonstrated knowledge must be true,
  primary, immediate, better known than and prior to the conclusion, which is further related to them as effect to
  cause." ([MIT Classics](https://classics.mit.edu/Aristotle/posterior.1.i.html))

Plainly: a first principle is a starting truth that does not rest on something else. For a process, that means a
constraint you cannot argue away (a law, a signed contract, a hard capacity), not a habit.

### A4. Socratic questioning: testing assumptions

- Primary: Plato, *Apology* 21b–23b. Socrates questions a man "who had the reputation of wisdom" and finds "he
  thought himself wise, but was not really wise." ([MIT Classics, trans. Jowett](https://classics.mit.edu/Plato/apology.html))
  The method is to question a belief until you see whether it holds up.
- Applied method: Richard Paul and Linda Elder, "Critical thinking: The art of Socratic questioning", *Journal of
  Developmental Education*, 2007–08 (parts I–III). One of their question types probes assumptions: "What are you
  assuming here?", "What could we assume instead?", "How can you verify or disprove that assumption?"
  (Not verified from primary: I saw these questions quoted, not the paper itself. Publisher page:
  [Foundation for Critical Thinking](https://www.criticalthinking.org/pages/socratic-teaching/606).)

For the app: each assumption gets one test question and one way to check it. The simulation is often that check.

### A5. Toyota's 5 Whys

- Taiichi Ohno, *Toyota Production System: Beyond Large-Scale Production* (Productivity Press, 1988; Japanese ed.
  1978), section "Repeating why five times". Widely quoted line: repeating why five times is "the basis of Toyota's
  scientific approach ... by repeating why five times, the nature of the problem as well as its solution becomes
  clear." His example: a machine stops → fuse blew from overload → bearing not lubricated → pump not pumping → pump
  shaft worn → no strainer, so metal scrap got in. Fixing the strainer, not the fuse, is the real fix.
  ([Routledge listing](https://www.routledge.com/9780915299140); wording via
  [Wikipedia, "Five whys"](https://en.wikipedia.org/wiki/Five_whys).) **Not verified from primary**: I do not have the
  book, so no page number.
- Toyota's own site once had "Ask 'why' five times about every matter" in its *Toyota Traditions* series (Mar/Apr
  2006). That URL now redirects to [global.toyota/en/company](https://global.toyota/en/company/). **Not verified**: I
  could not reach an archived copy.
- Caveat: a former Toyota purchasing director, Teruyuki Minoura, called it too basic for deep root causes
  (via [Wikipedia](https://en.wikipedia.org/wiki/Five_whys)). So use it to explain *why a requirement exists*, not as
  the only root-cause tool.

### A6. Jobs to be done (verified)

Clayton M. Christensen, Taddy Hall, Karen Dillon and David S. Duncan, "Know Your Customers' 'Jobs to Be Done'",
*Harvard Business Review*, September 2016
([hbr.org](https://hbr.org/2016/09/know-your-customers-jobs-to-be-done)):

> "What they really need to home in on is the progress that the customer is trying to make in a given
> circumstance—what the customer hopes to accomplish. This is what we've come to call the job to be done."

> "'Job' is shorthand for what an individual really seeks to accomplish in a given circumstance. ... The circumstances
> are more important than customer characteristics, product attributes, new technologies, or trends."

The article's summary also says to design "products, experiences, and processes around those jobs." The Christensen
Institute adds that jobs have "functional, social, and emotional dimensions"
([christenseninstitute.org](https://www.christenseninstitute.org/theory/jobs-to-be-done/)).

For the app: the process's purpose should be written as the **progress someone is trying to make**, with the
circumstance. Every step is then judged by whether it serves that job.

---

## Part B. Proposed "first principles" flow

Seven fields, filled in per process, in this order. The order follows Musk's algorithm, with the job (Christensen) and
the truths (Aristotle, Musk) in front of it. Each field is short, plain text plus a few structured parts the app can
check.

Running example: a digital marketing agency's **Sales** process, from new lead to signed retainer. Steps: lead in →
qualify → discovery call → proposal → MD review → negotiation → contract → signed retainer.

How the AI uses it (applies to every field): the engine produces all numbers and the LLM never invents them (PRD §3,
D15; [ADR 0011](../adr/0011-narration.md)). So the checks split in two:

- **Rule checks** run in code, like the detected issues (PRD §4.1). They are cheap and exact.
- **LLM review** reads the fields next to the run's facts and writes findings. Any number it cites is checked against
  the run JSON, as narration already does.

### 1. The job

- **Asks:** Who is this process for? What progress are they trying to make, and in what situation? What does "done"
  look like for them?
- **Example:** "For an owner of a 5–20 person business whose own marketing has stalled. They want a trusted partner
  running their marketing within two weeks, without a long buying process. Done = signed retainer and a kick-off date."
- **AI use:**
  - LLM: flag steps that serve no part of the job (candidates for field 4).
  - LLM: if the job mentions speed ("within two weeks"), compare it to simulated **cycle time** and say how often the
    run meets it.
  - Rule: warn if the job names no customer or no outcome.

### 2. Hard truths vs assumptions

- **Asks:** List the things that cannot change (laws, signed contracts, real capacity, physics of the work). Then list
  the beliefs that feel true but might not be. For each truth, give the source. For each assumption, give one way to
  test it.
- **Example:**
  - Truths: "A retainer needs a signed contract (contract law)." "The MD has 6 hours a week for sales calls (diary)."
    "Clients on annual budgets cannot sign until their budget is approved."
  - Assumptions: "Every proposal must be custom-written." Test: compare win rate of templated vs custom over last 20.
    "Leads go cold after 48 hours." Test: check CRM. "Only the MD can close." Test: has anyone else ever closed?
- **AI use:**
  - Rule: a "truth" with no source is shown as an assumption.
  - LLM: if an assumption maps to a parameter that robustness lists as a top sensitive input, say "test this first".
  - LLM: if a truth is a capacity limit, check simulated utilisation of that person or role against it.

### 3. Requirements, each with a named owner

- **Asks:** What rules or checks does this process have to follow? For each: the **named person** who set it (not a
  department), why it exists (ask "why" up to five times), and a verdict: keep, change or drop.
- **Example:**
  - "MD reviews every proposal." Owner: Sarah (MD). Why: one bad proposal under-priced a job in 2024. Verdict: change
    to review only proposals over £3k/month.
  - "Credit check before contract." Owner: "Finance". Why: unknown. Verdict: challenge.
- **AI use:**
  - Rule: flag any requirement whose owner is a team or role name, or blank (Musk/Isaacson step 1).
  - Rule: flag any requirement whose "why" is blank or "always done it".
  - LLM: link each requirement to the step it creates. If that step is the bottleneck or has high wait, say so with the
    run's numbers.

### 4. Delete candidates

- **Asks:** Which steps, handoffs or approvals might not need to exist? For each: what would break if it went, and who
  must agree. Aim to delete enough that you might add one back.
- **Example:** "MD review" (if the threshold rule above is accepted). "Separate qualify step" (fold into the discovery
  call booking form). "Second negotiation call" (send revised proposal by email instead).
- **AI use:**
  - The app builds a draft scenario with the step removed and runs it. The engine gives the change in cycle time,
    throughput and cost per unit.
  - Rule: if the list is empty, nudge: "Nothing proposed for deletion. Musk's rule of thumb: if you add back fewer than
    1 in 10, you didn't delete enough."
  - LLM: if a delete candidate is tied to a requirement marked "keep", point out the conflict.

### 5. Simplify, then accelerate, then automate

- **Asks:** For the steps that stay, list changes in three groups, in this order:
  - **Simplify:** fewer parts, fewer handoffs, templates, clearer rules.
  - **Accelerate:** shorter waits, faster turnaround, parallel work.
  - **Automate:** software or AI does the step.
- **Example:**
  - Simplify: three proposal templates by package size.
  - Accelerate: book discovery calls straight from the lead form; send proposal within 24 hours.
  - Automate: auto-send contract for e-signature when the proposal is accepted.
- **AI use:**
  - Rule (the key order check): flag any accelerate or automate change on a step that is listed in field 4 as a delete
    candidate, or whose requirement is still "challenge". Message: "You are speeding up or automating a step you have
    not decided to keep." This is Musk's "automated, accelerated, simplified and then deleted" mistake.
  - Rule: flag automation of a step with high rework. Automating a broken step makes errors faster.
  - Engine: each change becomes a scenario; compare view shows the gain with ranges and robustness.
  - LLM: rank changes by gain per effort, using only engine numbers.

### 6. Root cause of the biggest problem

- **Asks:** What is the one thing that most hurts this process today? Ask "why" until you hit something you can fix.
- **Example:** "Deals take 6 weeks. Why? Proposals wait for MD review. Why? MD reviews all of them. Why? A 2024
  under-pricing mistake. Why? No pricing guide. Fix: pricing guide + review only above £3k/month."
- **AI use:**
  - LLM: compare the stated problem with the engine's detected bottleneck and issues. If they differ, say so plainly:
    "You named proposal review; the simulation's bottleneck is the discovery call (MD at 97% utilisation)."
    Disagreement here is a finding, much like a perception gap (PRD §4.1).
  - Rule: flag a chain that stops at a person ("because Tom is slow"). Toyota's method looks for a process cause.

### 7. Success measures

- **Asks:** How will we know the process does its job better? Pick 2–4 measures from the KPIs the app already
  computes, with a target and a horizon.
- **Example:** "Cycle time, lead to signed: average under 21 days." "Win rate (throughput ÷ leads): at least 25%."
  "New MRR per quarter: at least £15k." "MD sales hours: under 6 a week."
- **AI use:**
  - Rule: each measure must map to an engine KPI (throughput, cycle time, cost per unit, new MRR, lost revenue,
    overtime hours, utilisation, hours freed; PRD §4.1). Free-text measures the engine cannot compute are marked
    "not checked by simulation".
  - Engine/template: for baseline and each scenario, show "meets target in N% of runs" using the existing range and
    robustness output.
  - LLM: say which proposed changes (fields 4–5) move each measure and which do not.

### Why these seven and not more

- Fields 1–2 are the "first principles" in the strict sense: what the process is for, and what is truly fixed.
- Fields 3–5 are Musk's five steps, merged to three fields so the form stays short. The order is kept and checked.
- Field 6 adds Toyota's root-cause habit.
- Field 7 makes the whole thing testable by the simulation, so the AI judges against numbers, not opinions.

### Suggested shape for storage (sketch, not a decision)

One record per process (or per draft), versioned with the process. Mostly free text, with these structured parts so
rule checks work:

- truths and assumptions: `{text, kind: truth|assumption, source?, test?, linked_parameter?}`
- requirements: `{text, owner_person_id?, owner_text, why, verdict: keep|change|drop|challenge, step_id?}`
- delete candidates: `{step_id, breaks_if_removed, agreed_by?}`
- improvements: `{step_id, stage: simplify|accelerate|automate, text, scenario_id?}`
- success measures: `{kpi, comparator, target, horizon}`

Linking an owner to a real person record (PRD people) is what makes "named person, not department" checkable.

---

## Part C. Not verified from a primary source

- Kevin Rose 2012 battery quote: secondary only (CNBC, *Super Thinking*). No timestamp.
- Starbase tour wording and timestamps (13:25/13:32–28:24): from CleanTechnica and Space Explored, not the video
  itself. The quotes may be lightly edited speech.
- Isaacson's wording, chapter number and page: from secondary excerpts and Fortune. Need the book to confirm.
- Ohno's book wording and page number: via Wikipedia and summaries. Toyota's own "Toyota Traditions" page could not be
  reached.
- Paul and Elder's question wording: quoted by others; paper not read.
