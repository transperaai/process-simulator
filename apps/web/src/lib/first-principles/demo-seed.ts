import { northbeamPersonIds, northbeamStepIds } from "@transpera-flow/db";
import type { FirstPrinciples } from "@transpera-flow/engine";

// A worked example for the demo's Northbeam pipeline (issue #119): enough answers in every step that the flow, its
// checks and the summary card show something. Fictional, like the rest of the sample.

const person = (name: string) => northbeamPersonIds[name]!;

export function demoFirstPrinciples(): FirstPrinciples {
  return {
    job: {
      who: "Founders of local service businesses (dentists, solicitors, trades)",
      progress: "Get more enquiries they can trust without learning marketing themselves",
      situation: "After a referral, or after a bad experience with another agency",
      done: "A signed 12-month retainer and a kickoff call in the diary",
    },
    statements: [
      { text: "Retainers are 12-month contracts", kind: "truth", source: "Contract template, v3", test: "", linked_parameter: null },
      { text: "One strategist, 37.5 hours a week", kind: "truth", source: "People settings", test: "", linked_parameter: null },
      { text: "Every proposal needs a full site audit", kind: "assumption", source: "", test: "Send 5 proposals with a light audit and compare the win rate", linked_parameter: null },
      { text: "Leads must be qualified before the first call", kind: "assumption", source: "", test: "", linked_parameter: null },
      { text: "Clients won't sign without speaking to a strategist", kind: "truth", source: "", test: "", linked_parameter: null },
    ],
    requirements: [
      {
        text: "The strategist writes every audit and proposal",
        owner_person_id: person("Maya Collins"),
        owner_text: "",
        why: "The audit is how we beat cheaper agencies",
        verdict: "challenge",
        step_id: northbeamStepIds.audit,
      },
      {
        text: "Every lead is qualified before anyone speaks to them",
        owner_person_id: null,
        owner_text: "Sales team",
        why: "We've always done it",
        verdict: "challenge",
        step_id: northbeamStepIds.qualify,
      },
      {
        text: "Contracts go out only after finance has checked the client",
        owner_person_id: null,
        owner_text: "Finance",
        why: "",
        verdict: "keep",
        step_id: northbeamStepIds.onboard,
      },
      {
        text: "Sales can't quote prices",
        owner_person_id: person("Rosa Diaz"),
        owner_text: "",
        why: "Pricing rules aren't written down",
        verdict: "change",
        step_id: null,
      },
    ],
    deletes: [
      {
        step_id: northbeamStepIds.qualify,
        breaks_if_removed: "Nothing before discovery; notes get taken on the call instead",
        agreed_by: person("Tom Reed"),
        added_back: false,
      },
    ],
    improvements: [
      { step_id: northbeamStepIds.audit, stage: "simplify", text: "One proposal template with three price tiers", scenario_id: null },
      { step_id: northbeamStepIds.discovery, stage: "accelerate", text: "Book discovery calls from a calendar link in the first reply", scenario_id: null },
      { step_id: northbeamStepIds.qualify, stage: "automate", text: "AI lead qualifier", scenario_id: null },
    ],
    why: {
      problem: "Proposals go out late",
      chain: ["The strategist is busy", "She writes every audit and also reviews every monthly report", "Only she can price and scope work"],
      root: "There are no written pricing and scoping rules",
    },
    measures: [
      { id: "m1", text: "At least 8 wins in the period", kpi: "won", comparator: "atLeast", target: 8, horizon: "3 months" },
      { id: "m2", text: "Win rate of at least 12%", kpi: "winRate", comparator: "atLeast", target: 0.12, horizon: "6 months" },
      { id: "m3", text: "Average time to complete under 250 working hours", kpi: "cycleHours", comparator: "atMost", target: 250, horizon: "6 months" },
      { id: "m4", text: "Clients feel looked after from the first call", kpi: null, comparator: "atLeast", target: null, horizon: "" },
    ],
  };
}
