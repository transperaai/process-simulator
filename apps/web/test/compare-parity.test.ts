import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { northbeamBundle, northbeamScenarios, toEngineModel } from "@transpera-flow/db";
import { applyPatches, compareHeadline, compareRuns, simulate } from "@transpera-flow/engine";
import { compareScenarios } from "@transpera-flow/mcp";
import { CompareView } from "@/components/compare-view";
import { headlineSubject } from "@/lib/scenarios/scenarios";

// MCP compare_scenarios and the app's compare view say the same thing
// (issue #26): the headline, and every cell of the KPI delta table.

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("compare parity", () => {
  it("renders the delta table and headline MCP returns for the same scenario", () => {
    const model = toEngineModel(northbeamBundle(), { startDate: "2026-10-05" });
    const scenario = northbeamScenarios().find((s) => s.name === "Automate proposals")!;
    const currency = northbeamBundle().workspace.settings.currency;

    // As ScenarioPanel does it: baseline run, scenario run, compareRuns, compareHeadline.
    const comparison = compareRuns(simulate(model, 30, 1), simulate(applyPatches(model, scenario.patch).model, 30, 1));
    const roleNames = Object.fromEntries(Object.entries(model.roles).map(([id, r]) => [id, r.name]));
    const headline = compareHeadline({
      comparison,
      ...headlineSubject([scenario.name], false),
      horizonWeeks: model.horizonWeeks,
      hoursPerWeek: model.hoursPerWeek,
      currency,
      roleNames,
    });
    const html = text(
      renderToStaticMarkup(
        createElement(CompareView, {
          comparison,
          headline,
          roleNames,
          people: {},
          currency,
          hoursPerWeek: model.hoursPerWeek,
          horizonWeeks: model.horizonWeeks,
          running: false,
          notes: [],
        }),
      ),
    );

    const mcp = compareScenarios({ model, a: [], b: [scenario], reps: 30, seed: 1, currency });
    expect(html).toContain(`|${mcp.headline}|`);
    for (const d of mcp.details) expect(html).toContain(`|${d}|`);
    for (const row of mcp.table) {
      const cells = [row.label, row.baseline, row.baselineRange, row.scenario, row.scenarioRange, row.change, row.changeRange];
      expect(html, row.label).toContain(`|${cells.join("|")}|`);
    }
  });
});
