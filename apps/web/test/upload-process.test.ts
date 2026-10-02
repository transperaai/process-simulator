import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, downloadHref, sourceLabel, uploadSizeProblem } from "@/lib/processes/upload";

// The small rules behind the Upload process dialog (issue #166): what a file name becomes in the change log, and which
// files are refused before they are read.

describe("sourceLabel", () => {
  it("keeps the file name and drops folders", () => {
    expect(sourceLabel("enquiry.json")).toBe("enquiry.json");
    expect(sourceLabel("C:\\Users\\sam\\Desktop\\enquiry.json")).toBe("enquiry.json");
    expect(sourceLabel("/home/sam/enquiry.json")).toBe("enquiry.json");
  });

  it("drops control characters, and falls back when nothing is left", () => {
    expect(sourceLabel("en\u0000quiry\n.json")).toBe("enquiry.json");
    expect(sourceLabel("   ")).toBe("uploaded file");
    expect(sourceLabel("")).toBe("uploaded file");
  });

  it("cuts a very long name", () => {
    expect(sourceLabel(`${"a".repeat(300)}.json`)).toHaveLength(200);
  });
});

describe("uploadSizeProblem", () => {
  it("accepts a process-sized file and refuses a huge one in plain words", () => {
    expect(uploadSizeProblem(20_000)).toBeNull();
    expect(uploadSizeProblem(MAX_UPLOAD_BYTES)).toBeNull();
    expect(uploadSizeProblem(MAX_UPLOAD_BYTES + 1)).toMatch(/probably the wrong file/);
    expect(uploadSizeProblem(2_500_000)).toContain("2,500 KB");
  });
});

describe("downloadHref", () => {
  it("is a JSON data link that decodes back to the text", () => {
    const text = '{"a": "é & ü"}\n';
    const href = downloadHref(text);
    expect(href.startsWith("data:application/json;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(href.split(",").slice(1).join(","))).toBe(text);
  });
});
