import { describe, expect, it } from "vitest";
import { lintRun, readRun, type Run } from "./extraction-fixtures";

// The Tidewater dry run's recorded tool calls, checked against the interview
// transcripts with no database (issue #27): quotes verbatim, numbers cited or
// reasoned, suggestions in the right shape. postgrest-extraction.test.ts
// replays the same files against a real database.

const clone = (run: Run): Run => JSON.parse(JSON.stringify(run));

describe("Tidewater dry run fixtures", () => {
  for (const name of ["run-1.json", "run-2.json"]) {
    it(`${name} is sound`, () => {
      expect(lintRun(readRun(name))).toEqual([]);
    });
  }

  it("catches a quote that is not verbatim", () => {
    const run = clone(readRun("run-1.json"));
    const step = (run.calls.find((c) => c.tool === "import_process")!.arguments.process_json as { steps: { evidence?: { quote: string }[] }[] }).steps[1]!;
    step.evidence![0]!.quote = "about an hour per client";
    expect(lintRun(run).join("\n")).toMatch(/not in the transcript verbatim/);
  });

  it("catches an unknown speaker, a wrong timestamp and a missing reason", () => {
    const run = clone(readRun("run-1.json"));
    const steps = (run.calls.find((c) => c.tool === "import_process")!.arguments.process_json as { steps: Record<string, unknown>[] }).steps;
    (steps[1]!.evidence as { speaker: string; timestamp: string }[])[0]!.speaker = "Hannah Iqbal";
    (steps[2]!.evidence as { timestamp: string }[])[0]!.timestamp = "09:59:59";
    delete steps[4]!.assumptions;
    const text = lintRun(run).join("\n");
    expect(text).toMatch(/not one of the source's speakers/);
    expect(text).toMatch(/timestamp "09:59:59" is not in the transcript/);
    expect(text).toMatch(/would fall to the server default/);
  });

  it("catches a source added with neither links nor link_later", () => {
    const run = clone(readRun("run-1.json"));
    delete run.calls.find((c) => c.tool === "add_source")!.arguments.link_later;
    expect(lintRun(run).join("\n")).toMatch(/pass link_later: true \(the import links it\) or links/);
  });

  it("catches a range that does not cite its midpoint, and a suggestion without evidence", () => {
    const run = clone(readRun("run-1.json"));
    const steps = (run.calls.find((c) => c.tool === "import_process")!.arguments.process_json as { steps: Record<string, unknown>[] }).steps;
    (steps[2]!.evidence as { value: number }[])[0]!.value = 2;
    delete run.calls.find((c) => c.tool === "upsert_person")!.arguments.evidence;
    const text = lintRun(run).join("\n");
    expect(text).toMatch(/must cite its midpoint/);
    expect(text).toMatch(/needs evidence/);
  });
});
