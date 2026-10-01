import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every field on the Editor screen has an (i) with a plain-English description and an example (issue #104, D34).
// The step inspector's fields take a `help` prop; this reads the source so a new field without one fails here.

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/** The opening tags of the fields in a source file, as written. */
function fieldTags(source: string): string[] {
  const out: string[] = [];
  const open = /<(TextField|NumberField|SelectField)\b/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    // The tag ends at the first `>` that isn't part of `=>` or inside braces.
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i++) {
      const c = source[i]!;
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    out.push(source.slice(m.index, i + 1));
  }
  return out;
}

describe("the Editor's inspector", () => {
  const tags = fieldTags(read("components/step-inspector.tsx"));

  it("finds the inspector's fields", () => {
    expect(tags.length).toBeGreaterThanOrEqual(15);
  });

  it("gives every field an (i) with a description and an example", () => {
    const missing = tags.filter((t) => !/help=\{\{/.test(t) || !/description:/.test(t) || !/example:/.test(t)).map((t) => /label="([^"]+)"/.exec(t)?.[1] ?? t.slice(0, 60));
    expect(missing).toEqual([]);
  });

  it("uses plain words, not jargon, in its labels", () => {
    const labels = tags.map((t) => /label="([^"]+)"/.exec(t)?.[1] ?? "");
    expect(labels.join("|")).not.toMatch(/\bCV\b|lognormal|triangular/i);
  });
});

describe("the Editor's own panels", () => {
  it("put an (i) beside every setting in the palette, inspector and footer", () => {
    for (const file of ["components/editor/palette.tsx", "components/editor/inspector.tsx", "components/editor/simulate-footer.tsx", "components/editor/editor-bar.tsx"]) {
      expect(read(file), file).toMatch(/<Help\b/);
    }
    // One for each heading and field of the palette, as the prototype has them.
    expect((read("components/editor/palette.tsx").match(/<Help\b/g) ?? []).length).toBe(3);
  });

  it("cites a source with an (i) on every field of the form", () => {
    const form = read("components/evidence.tsx");
    for (const label of ["Value", "Source", "Speaker", "Where", "Quote", "The value they stated"]) {
      expect(form, label).toContain(`label="${label}"`);
    }
  });
});
