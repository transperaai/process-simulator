import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every setting, lever and rule on the process page has an (i) with a description and an example (issue #103). Checked
// on the source: each of these labels must be given to a <Help> with both texts.

const read = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");

const EXPECT: Record<string, string[]> = {
  "components/process-page.tsx": ["Process type", "Process rating"],
  "components/wait-by-step.tsx": ["Wait before each step"],
  "components/utilisation-bars.tsx": ["How busy each role is", "Roles or people"],
  "components/horizon-picker.tsx": ["Projection"],
};

describe("process page help", () => {
  for (const [file, labels] of Object.entries(EXPECT)) {
    it(`${file} explains its controls`, () => {
      const text = read(file);
      for (const label of labels) {
        const at = text.indexOf(`label="${label}"`);
        expect(at, `${label} has no <Help>`).toBeGreaterThan(-1);
        const tag = text.slice(at, at + 700);
        expect(tag).toMatch(/description="/);
        expect(tag).toMatch(/example="/);
      }
    });
  }

  it("the sections carry help through <Section help>", () => {
    const text = read("components/process-page.tsx");
    for (const label of ["Map colours", "Insights", "Issues"]) expect(text).toContain(`label: "${label}"`);
  });

  it("every control in the Insights rows and pop-up has an (i) with a description and an example (issue #110)", () => {
    const text = read("components/insights.tsx");
    const labels = ["Filter by rating", "Reading a row", "Cost per month", "The number", "How it's worked out", "Linked sources", "Link a source", "Dismiss", "Acknowledge as issue", "Issue number"];
    for (const label of labels) {
      const at = text.indexOf(`label: "${label}"`);
      expect(at, `${label} has no help text`).toBeGreaterThan(-1);
      const entry = text.slice(at, at + 700);
      expect(entry).toMatch(/description:/);
      expect(entry).toMatch(/example:/);
    }
    // Each is used: the filter, the row, the dialog's fields and its three actions.
    for (const key of ["filter", "row", "cost", "number", "worked", "sources", "linkSource", "dismiss", "acknowledge", "issueLink"]) expect(text).toContain(`<Help {...INSIGHT_HELP.${key}} />`);
  });

  it("the headline cards and levers bring their own (i)", () => {
    expect(read("components/overview/headline-cards.tsx")).toContain("<Help");
    expect(read("components/lever-panel.tsx")).toContain("<Help");
  });
});
