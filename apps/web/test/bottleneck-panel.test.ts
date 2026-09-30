import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { northbeamBundle, northbeamRoleIds, toEngineModel } from "@transpera-flow/db";
import { rankBottlenecks, shadowPrice, shadowPriceText, simulate } from "@transpera-flow/engine";
import { BottleneckView } from "@/components/bottleneck-panel";

// The app's bottleneck panel (issue #26): Northbeam's top bottleneck and its
// shadow price, as MCP get_bottlenecks reports them.

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("BottleneckView", () => {
  const model = toEngineModel(northbeamBundle(), { startDate: "2026-10-05" });
  const result = simulate(model, 30, 1);
  const ranked = rankBottlenecks(model, result, { limit: 3 });

  it("shows the strategist's shadow price on Northbeam", () => {
    const sp = shadowPrice(model, northbeamRoleIds.strat, { reps: 30, seed: 1 })!;
    expect(ranked.top?.id).toBe(northbeamRoleIds.strat);
    expect(sp.perQuarter.mean).toBeGreaterThan(0);
    const html = text(renderToStaticMarkup(createElement(BottleneckView, { ranked, shadow: { status: "done", value: sp }, reps: 30 })));
    expect(html).toContain("Shadow price · +1 Strategist");
    expect(html).toContain(ranked.top!.evidence);
    expect(html).toContain(shadowPriceText(sp, "Strategist"));
    expect(html).toMatch(/\+[\d.]+ completions \/ quarter/);
  });

  it("says it is still pricing while the extra run is in flight", () => {
    const html = text(renderToStaticMarkup(createElement(BottleneckView, { ranked, shadow: { status: "running", value: null }, reps: 30 })));
    expect(html).toContain("Running 30 extra replications with one more full-time Strategist");
  });
});
