import { describe, expect, it } from "vitest";
import { EDITOR_MODES, MODE_INFO, exitHref, isEditorPath, parseEditorMode } from "@/lib/editor/modes";

// The Editor's modes and where it lives (issue #104).

describe("editor modes", () => {
  it("reads the mode from the address, and falls back to a draft", () => {
    expect(parseEditorMode("solution")).toBe("solution");
    expect(parseEditorMode(["block", "draft"])).toBe("block");
    expect(parseEditorMode("nonsense")).toBe("draft");
    expect(parseEditorMode(undefined)).toBe("draft");
  });

  it("says what each mode is in a hint and gives it its own save buttons", () => {
    for (const mode of EDITOR_MODES) {
      expect(MODE_INFO[mode].hint.length).toBeGreaterThan(20);
      expect(MODE_INFO[mode].save.length).toBeGreaterThan(0);
    }
    expect(MODE_INFO.draft.hint).toMatch(/live map doesn't change until you publish/);
    expect(MODE_INFO.draft.save.map((s) => s.label)).toEqual(["Save draft", "Publish…"]);
    expect(MODE_INFO.solution.save.map((s) => s.label)).toEqual(["Save solution"]);
    expect(MODE_INFO.block.save.map((s) => s.label)).toEqual(["Save to library"]);
    // Only the draft is built; the others plug in later.
    expect(EDITOR_MODES.filter((m) => MODE_INFO[m].available)).toEqual(["draft"]);
    expect(MODE_INFO.draft.title("Lead to live")).toBe("Draft of Lead to live");
  });

  it("returns to the page it came from, but only a page of this site", () => {
    expect(exitHref("/w/acme/issues", "/w/acme/p/1")).toBe("/w/acme/issues");
    expect(exitHref(undefined, "/w/acme/p/1")).toBe("/w/acme/p/1");
    expect(exitHref("https://elsewhere.example/", "/demo")).toBe("/demo");
    expect(exitHref("//elsewhere.example/", "/demo")).toBe("/demo");
    expect(exitHref("/\\elsewhere.example", "/demo")).toBe("/demo");
    // What a browser strips or rewrites before it follows a link.
    expect(exitHref("/\t/example.org/phish", "/demo")).toBe("/demo");
    expect(exitHref("\t//example.org", "/demo")).toBe("/demo");
    expect(exitHref("/\n/example.org", "/demo")).toBe("/demo");
    expect(exitHref("\\\\example.org", "/demo")).toBe("/demo");
    expect(exitHref("javascript:alert(1)", "/demo")).toBe("/demo");
    // Encoded, it is only a path of this site.
    expect(exitHref("/%09/example.org/phish", "/demo")).toBe("/%09/example.org/phish");
    expect(exitHref("/w/acme/issues?x=1#top", "/demo")).toBe("/w/acme/issues?x=1#top");
  });

  it("knows which pages are the Editor, which show no sidebar", () => {
    expect(isEditorPath("/demo/edit")).toBe(true);
    expect(isEditorPath("/w/acme/p/3f1c/edit")).toBe(true);
    expect(isEditorPath("/w/acme/p/3f1c")).toBe(false);
    expect(isEditorPath("/demo")).toBe(false);
    expect(isEditorPath("/w/acme/edit")).toBe(false);
    expect(isEditorPath(null)).toBe(false);
  });
});
