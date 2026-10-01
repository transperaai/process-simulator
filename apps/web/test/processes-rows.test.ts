import { describe, expect, it } from "vitest";
import { processRatings, processRows, shortDate, type ProcessFacts } from "@/lib/processes/rows";

// The Processes page's rows (issue #101): company-map order with sub-processes indented, and each row's numbers
// rolled up over the processes inside it.

const proc = (id: string, parentId: string | null = null, over: Partial<ProcessFacts> = {}): ProcessFacts => ({
  id,
  name: id.toUpperCase(),
  kind: "pipeline",
  description: null,
  parentId,
  live: true,
  draft: false,
  ...over,
});
const step = (id: string, process_id: string, kind: "task" | "start" | "end" | "group" | "wait" = "task", child_process_id: string | null = null) => ({ id, process_id, kind, child_process_id });
const issue = (process_id: string | null, severity: "info" | "warning" | "serious" | "critical", status: "open" | "in_progress" | "done" | "dismissed" = "open", step_id: string | null = null) => ({
  process_id,
  step_id,
  severity,
  status,
});

describe("processRows", () => {
  const processes = [proc("a"), proc("b", "a"), proc("c", "b"), proc("d", null, { kind: "servicing" })];

  it("lists processes in company-map order, indented by depth, with the trail above each", () => {
    const rows = processRows({ processes: [proc("d"), proc("b", "a"), proc("a"), proc("c", "b")], steps: [], issues: [], versions: new Map() });
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ["d", 1],
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(rows.find((r) => r.id === "c")!.trail).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    expect(rows.find((r) => r.id === "a")!.trail).toEqual([]);
  });

  it("counts working steps, leaving out markers, boxes and holders of a child process, and adds those of the processes inside", () => {
    const rows = processRows({
      processes,
      steps: [step("1", "a"), step("2", "a", "start"), step("3", "a", "group"), step("4", "a", "task", "b"), step("5", "b"), step("6", "b", "wait"), step("7", "c")],
      issues: [],
      versions: new Map(),
    });
    const n = (id: string) => rows.find((r) => r.id === id)!.steps;
    expect(n("c")).toBe(1);
    expect(n("b")).toBe(3);
    expect(n("a")).toBe(4);
    expect(n("d")).toBe(0);
  });

  it("counts open issues and takes the worst rating, rolled up; a Great or closed issue does not rate", () => {
    const rows = processRows({
      processes,
      steps: [],
      issues: [issue("c", "warning"), issue("b", "serious"), issue("b", "critical", "done"), issue("a", "info"), issue("d", "info"), issue("d", "serious", "dismissed")],
      versions: new Map(),
    });
    const r = (id: string) => rows.find((x) => x.id === id)!;
    expect(r("c")).toMatchObject({ openIssues: 1, rating: "good" });
    expect(r("b")).toMatchObject({ openIssues: 2, rating: "bad" });
    expect(r("a")).toMatchObject({ openIssues: 3, rating: "bad" });
    expect(r("d")).toMatchObject({ openIssues: 1, rating: null });
  });

  it("places an issue with no process by its step", () => {
    const rows = processRows({ processes, steps: [step("s1", "c")], issues: [issue(null, "critical", "in_progress", "s1")], versions: new Map() });
    expect(rows.find((r) => r.id === "a")).toMatchObject({ openIssues: 1, rating: "risk" });
  });

  it("carries the live version, and a process that was never published has none", () => {
    const rows = processRows({
      processes: [proc("a"), proc("b", null, { live: false, draft: true })],
      steps: [],
      issues: [],
      versions: new Map([["a", { number: 4, publishedAt: "2026-09-29T10:00:00Z" }]]),
    });
    expect(rows[0]!.version).toEqual({ number: 4, publishedAt: "2026-09-29T10:00:00Z" });
    expect(rows[1]).toMatchObject({ version: null, live: false, draft: true });
  });

  it("treats a process whose parent is missing as top level", () => {
    const rows = processRows({ processes: [proc("x", "gone")], steps: [], issues: [], versions: new Map() });
    expect(rows[0]).toMatchObject({ depth: 1, trail: [] });
  });
});

describe("processRatings", () => {
  it("gives each process the worst rating of its open issues and those inside it", () => {
    expect(processRatings([proc("a"), proc("b", "a")], [issue("b", "critical")])).toEqual({ a: "risk", b: "risk" });
    expect(processRatings([proc("a")], [])).toEqual({ a: null });
  });
});

describe("shortDate", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("leaves the year off for this year", () => {
    expect(shortDate("2026-09-29T10:00:00Z", now)).toBe("29 Sep");
    expect(shortDate("2025-01-05T10:00:00Z", now)).toBe("5 Jan 2025");
  });
  it("is empty without a date", () => {
    expect(shortDate(null, now)).toBe("");
    expect(shortDate("nope", now)).toBe("");
  });
});
