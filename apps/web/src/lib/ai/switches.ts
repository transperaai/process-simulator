// The five switches of Settings -> AI analysis (issue #111, A46), with their plain-English help. Wording follows the
// prototype (apps/web/prototype/app-flow.html, Settings -> AI analysis). The two "suggest" switches are enforced by the MCP
// propose tools (A52): when one is off, Claude can't propose that kind of suggestion.

import type { AiSettingKey } from "@transpera-flow/db";

export interface AiSwitch {
  key: AiSettingKey;
  label: string;
  description: string;
  example: string;
  /** True while the page it feeds doesn't exist: the switch saves, and does nothing yet. No switch needs it now. */
  later?: boolean;
}

export const AI_SWITCHES: readonly AiSwitch[] = [
  {
    key: "review_on_publish",
    label: "Review after each published version",
    description: "When you publish a new version of a process, AI looks at the results and writes what it notices: a short read, and insights for the list. It uses only numbers the simulation produced.",
    example: "“Proposals now go out faster, but fewer are being won.”",
  },
  {
    key: "review_on_market",
    label: "Review when market conditions change",
    description: "When you change the market conditions or their schedule, AI checks which processes are hit hardest and updates its read.",
    example: "“In a downturn, the strategist has more time, but more clients leave.”",
  },
  {
    key: "suggest_issues",
    label: "Suggest issues (they land in Suggestions)",
    description:
      "AI can suggest new issues. They wait in Suggestions until you accept or reject them, and nothing is added to your issues on its own. Turn it off and Claude can no longer propose issues.",
    example: "“Clients wait 20 hours for answers to requests.”",
  },
  {
    key: "suggest_solutions",
    label: "Suggest solution ideas using blocks from the library",
    description:
      "AI can suggest ideas for solutions, built from the blocks in your library. They wait in Suggestions until someone builds or dismisses them, and nothing is tested before then. Turn it off and Claude can no longer propose solution ideas.",
    example: "“Let partner leads skip the fit check.”",
  },
  {
    key: "read_sources",
    label: "Read linked sources and quotes",
    description:
      "AI reads short quotes from the interview notes and transcripts linked to your steps, and may quote them to explain the numbers. Those quotes are sent to Anthropic, the company behind the AI, so it is off until you turn it on. It never copies a figure out of a quote. Turning it off does not stop everything else being sent: your first principles (including the source notes on your truths) and the names of the process, its steps and roles are always sent when AI reviews a version. People's names are replaced by labels.",
    example: "Quotes Maya: “Most weeks that's my Sunday.”",
  },
] as const;
