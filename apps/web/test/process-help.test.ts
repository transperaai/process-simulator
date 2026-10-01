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
    for (const label of ["First principles", "Map colours", "Insights", "Issues"]) expect(text).toContain(`label: "${label}"`);
  });

  it("the headline cards and levers bring their own (i)", () => {
    expect(read("components/overview/headline-cards.tsx")).toContain("<Help");
    expect(read("components/lever-panel.tsx")).toContain("<Help");
  });
});
