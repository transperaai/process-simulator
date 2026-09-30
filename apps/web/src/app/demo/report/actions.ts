"use server";

import { editCheck, reportNarrationInput } from "@/lib/narration/facts";
import { checkText } from "@/lib/narration/narrate";
import type { NumberProblem } from "@/lib/narration/numbers";
import type { ExecutiveSummary } from "@/lib/report/content";
import { demoReportContent } from "@/lib/report/demo";
import { paragraphsFrom } from "@/lib/report/narration";

// The demo builder's summary editor (issue #29): load the summary the demo
// report would print (templated, or narrated by the stand-in), and check an
// edit against the report's figures before printing. No database, no API.

const paramsOf = (sections: string[], scenarioIds: string[], narrate: boolean) => {
  const p = new URLSearchParams();
  for (const s of ["cover", ...sections]) p.append("sections", s);
  for (const s of scenarioIds) p.append("scenarios", s);
  if (narrate) p.set("narrate", "1");
  return p;
};

export async function demoSummary(sections: string[], scenarioIds: string[], narrate: boolean): Promise<{ status: "ok"; summary: ExecutiveSummary | null }> {
  const built = await demoReportContent(paramsOf(sections, scenarioIds, narrate));
  return { status: "ok", summary: built.ok ? built.content.summary : null };
}

export async function demoCheckSummary(
  sections: string[],
  scenarioIds: string[],
  text: string,
): Promise<{ status: "ok"; checked: number } | { status: "invalid"; problems: NumberProblem[] } | { status: "error"; message: string }> {
  const built = await demoReportContent(paramsOf(sections, scenarioIds, false));
  if (!built.ok || !built.content.summary) return { status: "error", message: "Include the executive summary section to edit it." };
  const check = checkText(paragraphsFrom(text), editCheck(reportNarrationInput(built.content)));
  return check.ok ? { status: "ok", checked: check.numbers.length } : { status: "invalid", problems: check.problems };
}
