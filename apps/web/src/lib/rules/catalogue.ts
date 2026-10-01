// What Settings -> Analysis rules shows for each rule: its plain name, the number it rates, the cut-offs a person
// edits, how the four bands read for a set of cut-offs, how the cost per month is worked out, and the (i) text.
// Wording follows the prototype (apps/web/prototype/app-flow.html, RULE_DEFS and HELP). The rules themselves, their
// defaults and their order checks are in the engine (packages/engine/src/analysis-settings.ts); this file is only
// how they read. Pure, so the wording and the bands are unit-tested.

import { ANALYSIS_RULE_IDS, ANALYSIS_RULE_SPECS, type AnalysisRuleId, type OverrideKind } from "@transpera-flow/engine";

/** One cut-off a person edits. */
export interface RuleInput {
  /** The label beside the box: "Great up to". */
  label: string;
  /** What the number counts: "%", "×", "items/wk", "weeks", or "" for a plain score. */
  unit: string;
  /** Stored value × scale is what the box shows (a stored 0.7 shows as 70 %). */
  scale: number;
  /** The step of the number box. */
  step: number;
}

export interface RuleUi {
  id: AnalysisRuleId;
  /** The prototype's plain name. */
  name: string;
  /** The number it rates, in plain words. */
  rates: string;
  inputs: RuleInput[];
  /** The four bands (Great, Good, Bad, Operational risk) for cut-offs in display units; "" is a band the rule doesn't have. */
  bands: (v: number[]) => [string, string, string, string];
  /** How the cost per month is worked out. */
  cost: string;
  /** Plain-English description and an example, for the (i). */
  help: { description: string; example: string };
  /** What an override can be attached to, most useful first. */
  overrideKinds: readonly OverrideKind[];
  /** The label of the wait override's expected wait box, for the one rule that has one. */
  hasExpectedWait?: boolean;
}

const pct = (label: string): RuleInput => ({ label, unit: "%", scale: 100, step: 1 });
const times = (label: string): RuleInput => ({ label, unit: "×", scale: 1, step: 0.05 });

/** A number as people write it: no trailing zeros. */
export const shown = (n: number): string => String(Number(n.toFixed(2)));

const UI: Record<AnalysisRuleId, Omit<RuleUi, "id" | "overrideKinds">> = {
  busy: {
    name: "Too busy",
    rates: "How full someone's week is",
    inputs: [pct("Great up to"), pct("Good up to"), pct("Bad up to")],
    bands: (c) => [`under ${shown(c[0]!)}%`, `${shown(c[0]!)}–${shown(c[1]!)}%`, `${shown(c[1]!)}–${shown(c[2]!)}%`, `over ${shown(c[2]!)}%`],
    cost: "Extra wins one more person would bring × value of a loss, plus overtime",
    help: {
      description: "How full someone's week is. Too full, and work starts to pile up.",
      example: "Maya is busy 82% of her week. In a bad month it's 97%. That's too full.",
    },
  },
  spare: {
    name: "Spare time",
    rates: "How empty someone's week is",
    inputs: [pct("Opportunity under")],
    bands: (c) => ["", `under ${shown(c[0]!)}% · shown as an opportunity`, "", ""],
    cost: "Idle hours × cost rate",
    help: {
      description: "Someone has lots of free time. They could help a busier person.",
      example: "Sales is only busy 12% of the week. They could take some work off Maya.",
    },
  },
  overtime: {
    name: "Overtime",
    rates: "How much of the overtime limit is used",
    inputs: [pct("Bad from"), pct("Operational risk at")],
    bands: (c) => ["none", "", `${shown(c[0]!)}%+ of the limit used`, `${shown(c[1]!)}%+ · limit used up`],
    cost: "Overtime hours × cost rate",
    help: {
      description: "Extra hours people work to keep up. It is rated on how much of the overtime limit (Settings → Company) they use.",
      example: "Nina works 3 extra hours a week to keep up with her clients.",
    },
  },
  queue: {
    name: "Work piling up",
    rates: "How fast the pile grows each week",
    inputs: [{ label: "Operational risk from", unit: "items/wk", scale: 1, step: 0.1 }],
    bands: (c) => ["", "", "", `${shown(c[0]!)}+ items a week`],
    cost: "Value of the work stuck in the queue",
    help: {
      description: "Work comes in faster than it gets done, so the pile keeps getting bigger.",
      example: "Each week, one more report is waiting for review than the week before.",
    },
  },
  wait: {
    name: "Waiting too long",
    rates: "Wait compared with the expected wait",
    inputs: [times("Great up to"), times("Good up to"), times("Bad up to")],
    bands: (c) => [`within ${shown(c[0]!)}×`, `up to ${shown(c[1]!)}×`, `up to ${shown(c[2]!)}×`, `over ${shown(c[2]!)}×`],
    cost: "Deals lost through the step's drop-off per day of waiting",
    help: {
      description: "How long work sits before someone starts it, compared with how long it should sit.",
      example: "New leads should get a reply in 4 hours. They wait 20 hours.",
    },
    hasExpectedWait: true,
  },
  rework: {
    name: "Rework",
    rates: "Share of work done twice",
    inputs: [pct("Great under"), pct("Good up to"), pct("Bad up to")],
    bands: (c) => [`under ${shown(c[0]!)}%`, `${shown(c[0]!)}–${shown(c[1]!)}%`, `${shown(c[1]!)}–${shown(c[2]!)}%`, `over ${shown(c[2]!)}%`],
    cost: "Repeated hours × cost rate",
    help: { description: "How often work has to be done again.", example: "8 out of every 100 proposals have to be redone." },
  },
  sla: {
    name: "Missed deadlines",
    rates: "Share of deadlines missed",
    inputs: [pct("Great under"), pct("Good up to"), pct("Bad up to")],
    bands: (c) => [`under ${shown(c[0]!)}%`, `${shown(c[0]!)}–${shown(c[1]!)}%`, `${shown(c[1]!)}–${shown(c[2]!)}%`, `over ${shown(c[2]!)}%`],
    cost: "Churned revenue through the churn drivers",
    help: { description: "How often you miss a deadline you promised.", example: "Reports are promised by the 5th working day. 14 in 100 are late." },
  },
  spof: {
    name: "Only one person can do it",
    rates: "Work lost, and weeks to catch up, when they're away",
    inputs: [pct("Great: lost under"), pct("Operational risk: lost over"), { label: "Great: back within", unit: "weeks", scale: 1, step: 1 }, { label: "Operational risk: not back in", unit: "weeks", scale: 1, step: 1 }],
    bands: (c) => [
      `under ${shown(c[0]!)}% lost, back in ${shown(c[2]!)} wk`,
      "",
      `${shown(c[0]!)}–${shown(c[1]!)}% lost or ${shown(c[2]!)}–${shown(c[3]!)} wk`,
      `over ${shown(c[1]!)}%, over ${shown(c[3]!)} wk, or a client deadline missed`,
    ],
    cost: "Damage of one absence × absences a year ÷ 12",
    help: {
      description: "Only one person can do a job. What happens if they're away for 2 weeks?",
      example: "If Maya is away, a quarter of proposals stop, and it takes 5 weeks to catch up.",
    },
  },
  health: {
    name: "Client health",
    rates: "Client group score, 0 to 100",
    inputs: [
      { label: "Great from", unit: "", scale: 1, step: 1 },
      { label: "Good from", unit: "", scale: 1, step: 1 },
      { label: "Bad from", unit: "", scale: 1, step: 1 },
    ],
    bands: (c) => [`${shown(c[0]!)}+`, `${shown(c[1]!)}–${shown(c[0]!)}`, `${shown(c[2]!)}–${shown(c[1]!)}`, `under ${shown(c[2]!)}`],
    cost: "Churned clients × value of a loss",
    help: {
      description: "A score from 0 to 100 for how happy a group of clients is. Late work makes it drop.",
      example: "PPC clients score 61 because their reports are often late.",
    },
  },
  driver: {
    name: "Cause of clients leaving",
    rates: "Share of lost clients it causes",
    inputs: [pct("Bad from"), { label: "Operational risk if group health under", unit: "", scale: 1, step: 1 }],
    bands: (c) => ["", "", `${shown(c[0]!)}%+ of churn`, `${shown(c[0]!)}%+ and group under ${shown(c[1]!)}`],
    cost: "That driver's share of churned revenue",
    help: { description: "What's causing clients to leave.", example: "Late reports cause 41 out of every 100 clients who leave." },
  },
  success: {
    name: "Goals met",
    rates: "How often the goal is met",
    inputs: [pct("Great from"), pct("Good from"), pct("Bad from")],
    bands: (c) => [`${shown(c[0]!)}%+`, `${shown(c[1]!)}–${shown(c[0]!)}%`, `${shown(c[2]!)}–${shown(c[1]!)}%`, `under ${shown(c[2]!)}%`],
    cost: "Depends on the measure",
    help: {
      description: "Checks the goals you set for a process. How often are they met?",
      example: "“Send proposals within 3 days” happens 58 times out of 100.",
    },
  },
  dropoff: {
    name: "Work lost at a step",
    rates: "Work lost compared with your normal",
    inputs: [times("Good up to"), times("Bad up to")],
    bands: (c) => ["at or better", `up to ${shown(c[0]!)}×`, `up to ${shown(c[1]!)}×`, `over ${shown(c[1]!)}×`],
    cost: "Lost items × value of a loss",
    help: {
      description: "How much work is lost at a step, compared with what's normal for you.",
      example: "Normally 60 in 100 prospects say no. Right now it's 68.",
    },
  },
  cycle: {
    name: "Too slow overall",
    rates: "Start-to-finish time compared with the target",
    inputs: [times("Good up to"), times("Bad up to")],
    bands: (c) => ["within target", `up to ${shown(c[0]!)}×`, `up to ${shown(c[1]!)}×`, `over ${shown(c[1]!)}×`],
    cost: "Revenue delayed",
    help: {
      description: "How long a process takes from start to finish, compared with your target.",
      example: "You want new clients signed in 10 days. It takes 12.",
    },
  },
  sources: {
    name: "Numbers don't match",
    rates: "How far apart the two numbers are",
    inputs: [times("Bad from")],
    bands: (c) => ["", "", `${shown(c[0]!)}× or more`, ""],
    cost: "None: a data-quality finding",
    help: {
      description: "Two people or records give very different numbers for the same thing.",
      example: "Tom says checking a lead takes 10 minutes. The CRM says 25.",
    },
  },
  broken: {
    name: "Broken solution",
    rates: "Solution uses a step that's gone",
    inputs: [],
    bands: () => ["", "", "always", ""],
    cost: "None: a data-quality finding",
    help: {
      description: "A saved solution uses a step that has since been changed or deleted.",
      example: "A solution changes “Qualify lead”, but that step was renamed later.",
    },
  },
};

/** Rules whose detector already runs but still on its old cut-offs: switching them off works now, their cut-offs apply later. */
export const OLD_LOGIC: ReadonlySet<AnalysisRuleId> = new Set<AnalysisRuleId>(["health", "sources", "broken"]);

/** Which kinds of override make sense for a rule, from the prototype's `over`. All kinds are allowed; this orders the picker. */
const OVERRIDE_KINDS: Record<AnalysisRuleId, readonly OverrideKind[]> = {
  busy: ["role", "person", "step", "service", "process"],
  spare: ["role", "person", "step", "service", "process"],
  overtime: ["person", "role", "step", "service", "process"],
  queue: ["step", "role", "person", "service", "process"],
  wait: ["step", "role", "person", "service", "process"],
  rework: ["step", "role", "person", "service", "process"],
  sla: ["step", "role", "person", "service", "process"],
  spof: ["person", "role", "step", "service", "process"],
  health: ["service", "process", "step", "role", "person"],
  driver: [],
  success: ["process", "step", "role", "person", "service"],
  dropoff: ["step", "role", "person", "service", "process"],
  cycle: ["process", "step", "role", "person", "service"],
  sources: [],
  broken: [],
};

export const RULES_UI: Record<AnalysisRuleId, RuleUi> = Object.fromEntries(
  ANALYSIS_RULE_IDS.map((id) => [id, { id, ...UI[id], overrideKinds: ANALYSIS_RULE_SPECS[id].overridable ? OVERRIDE_KINDS[id] : [] }]),
) as Record<AnalysisRuleId, RuleUi>;

/** Stored inputs as the boxes show them. */
export const toDisplay = (rule: AnalysisRuleId, inputs: readonly number[]): number[] =>
  inputs.map((v, i) => Number((v * RULES_UI[rule].inputs[i]!.scale).toFixed(4)));

/** What the boxes show, as stored inputs. */
export const fromDisplay = (rule: AnalysisRuleId, display: readonly number[]): number[] =>
  display.map((v, i) => Number((v / RULES_UI[rule].inputs[i]!.scale).toFixed(6)));

/** The four bands for stored inputs, as the table and the live preview show them. */
export function bandsOf(rule: AnalysisRuleId, inputs: readonly number[]): [string, string, string, string] {
  return RULES_UI[rule].bands(toDisplay(rule, inputs));
}

export const KIND_NAMES: Record<OverrideKind, { one: string; many: string }> = {
  person: { one: "person", many: "People" },
  step: { one: "step", many: "Steps" },
  role: { one: "role", many: "Roles" },
  service: { one: "service", many: "Services" },
  process: { one: "process", many: "Processes" },
};

/** The (i) text of the escalators, the money settings and the page's own controls (prototype HELP "set.*"). */
export const SETTING_HELP = {
  badMonth: {
    label: "Count busy months",
    description: "Looks at busy months too, not just the average, so problems that only show up sometimes still count.",
    example: "Maya is fine on average, but overloaded in a busy month. So she's flagged.",
  },
  bottleneck: {
    label: "Slowest step",
    description: "If the problem is at the step that slows everything down, it counts as more serious.",
    example: "Everything waits on Maya, so her problem is moved up to the most serious level.",
  },
  cap: {
    label: "Lost client or deal",
    description: "The most money one lost client or deal can count as.",
    example: "A client paying A$4,000 a month who leaves counts as A$48,000 at most (12 months).",
  },
  absence: {
    label: "Someone away",
    description: "How long to pretend someone is away when testing what happens, and how often that happens in a year.",
    example: "Off for 2 weeks, about twice a year.",
  },
  wait: {
    label: "Normal wait",
    description: "How long work should wait, for steps where you haven't set your own time.",
    example: "8 hours = 1 working day. 16 hours = 2 working days.",
  },
  currency: {
    label: "Currency",
    description: "The currency for all money amounts. It is set in Company settings.",
    example: "A$ (Australian dollars).",
  },
  overrides: {
    label: "Overrides",
    description: "Use different cut-offs for one role, person, step, service or process. The most specific one wins.",
    example: "Keep Maya's busy limit lower, because nobody can cover her.",
  },
  cutoffs: {
    label: "Cut-offs",
    description: "The numbers that split a result into Great, Good, Bad and Operational risk. The default is shown beside each one.",
    example: "Too busy: Great under 70%, Good up to 85%, Bad up to 95%.",
  },
  absenceWeeks: {
    label: "Weeks someone is away",
    description: "How many weeks to pretend someone is away when testing what happens.",
    example: "2 means the test takes someone out for a fortnight.",
  },
  absenceTimes: {
    label: "Times a year someone is away",
    description: "How often that happens in a year, to work out what it costs.",
    example: "2 means about twice a year.",
  },
  waitSales: {
    label: "Normal wait for sales steps",
    description: "How many hours work should wait at a sales step where you haven't set your own time.",
    example: "8 hours is 1 working day.",
  },
  waitClient: {
    label: "Normal wait for client work",
    description: "How many hours work should wait at a client-work step where you haven't set your own time.",
    example: "16 hours is 2 working days.",
  },
  useRule: {
    label: "Use this rule",
    description: "Switch a rule off and the app stops rating things with it. Your numbers for it are kept.",
    example: "Turn off Spare time if you don't want to look for people with free hours.",
  },
  cutoff: {
    label: "Cut-off",
    description: "A number where one rating stops and the next starts. The agreed default is shown beside the box.",
    example: "Too busy, Great up to 70%: anyone busy under 70% of their week is rated Great.",
  },
  overrideTarget: {
    label: "What it applies to",
    description: "Pick the one role, person, step, service or process that needs different cut-offs from everyone else.",
    example: "Pick Maya Collins to give her a lower busy limit than the rest of the team.",
  },
  overrideWhy: {
    label: "Why",
    description: "A note for your team on why this one is different. Optional.",
    example: "Only strategist; keep her lower.",
  },
  overrideOff: {
    label: "Don't use this rule for it",
    description: "Skips this rule for just this one subject, so it is never rated by it.",
    example: "Don't rate rework on the kickoff call, where doing it twice is normal.",
  },
  expectedWait: {
    label: "Expected wait",
    description: "How long work should sit before someone starts it, for this one subject. It replaces the normal wait.",
    example: "New leads should get a reply in 4 hours, not 1 working day.",
  },
} as const;
