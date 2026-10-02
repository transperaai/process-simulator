import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LinkTargets, SourceLinkRow, SourceRow } from "@transpera-flow/db";
import { linkColumns } from "@transpera-flow/db";
import { LINKED_SOURCES_HELP, LinkedSources, SourceLinkingProvider, withTarget } from "@/components/sources/linking";
import { StepDetail } from "@/components/map/step-detail";
import { NEEDS_A_SOURCE } from "@/lib/sources/links";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/w/[slug]/source-actions", () => ({ createSource: async () => ({}), saveSourceField: async () => ({}), deleteSource: async () => ({}), linkSource: async () => ({}), unlinkSource: async () => ({}) }));

// "+ Link" on every screen a source can be evidence for (issue #118, A53 slice 2): the step detail, the Editor's inspector, the
// insight pop-up, the issue page and the process page share one provider, one dialog and one Sources block.

const WS = "a0000000-0000-4000-8000-000000000001";
const P1 = "c0000000-0000-4000-8000-000000000001";
const S1 = "e0000000-0000-4000-8000-000000000003";
const I1 = "40000000-0000-4000-8000-000000000001";
const KEY = `spof:step:${S1}`;
const at = "2026-10-02T09:00:00Z";

const source = (n: number, title: string, body: string | null): SourceRow => ({
  id: `30000000-0000-4000-8000-00000000000${n}`,
  workspace_id: WS,
  kind: n === 2 ? "notes" : "transcript",
  title,
  speakers: [],
  recorded_at: "2026-09-12",
  body,
  file_url: null,
  created_at: at,
  updated_at: at,
});
const sources = [source(1, "Strategy walkthrough", "A proper audit and proposal is a day's work."), source(2, "Sales team notes", null), source(3, "Ops notes", "Access requests go back and forth.")];
const link = (n: number, sourceN: number, t: Parameters<typeof linkColumns>[0]): SourceLinkRow => ({ id: `b0000000-0000-4000-8000-00000000000${n}`, workspace_id: WS, source_id: sources[sourceN - 1]!.id, ...linkColumns(t), created_at: at, created_by: null });
const links = [link(1, 1, { kind: "step", processId: P1, stepId: S1 }), link(2, 2, { kind: "step", processId: P1, stepId: S1 }), link(3, 1, { kind: "issue", issueId: I1 })];
const targets: LinkTargets = {
  processes: [{ id: P1, name: "Lead to live" }],
  steps: [{ id: S1, processId: P1, name: "Audit & proposal" }],
  insights: [],
  issues: [{ id: I1, number: 1, title: "Every proposal is built by hand" }],
  solutions: [],
};

const inProvider = (child: ReturnType<typeof createElement>, mode: "live" | "demo" | "readonly" = "live") =>
  renderToStaticMarkup(createElement(SourceLinkingProvider, { workspaceId: WS, mode, sources, links, targets }, child));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const stepBlock = createElement(LinkedSources, { target: { kind: "step", processId: P1, stepId: S1 }, label: "Step: Audit & proposal" });

describe("the Sources block", () => {
  it("lists what is linked to the thing, with title, type and quote, and a + Link", () => {
    const html = inProvider(stepBlock);
    const t = text(html);
    expect(t).toContain("Strategy walkthrough");
    expect(t).toContain("· Transcript");
    expect(t).toContain("“A proper audit and proposal is a day's work.”");
    expect(t).toContain("Sales team notes");
    expect(t).toContain("· Notes");
    // Not what is linked to something else.
    expect(t).not.toContain("Ops notes");
    expect(html).toContain(">+ Link</button>");
    expect(html).toContain("Link a source to Step: Audit &amp; proposal");
    expect(html).toContain("Remove link: Strategy walkthrough");
  });

  it("says so when nothing is linked yet", () => {
    const html = inProvider(createElement(LinkedSources, { target: { kind: "process", processId: P1 }, label: "Process: Lead to live", empty: "No source linked to this process yet." }));
    expect(text(html)).toContain("No source linked to this process yet.");
    expect(html).toContain(">+ Link</button>");
  });

  it("shows an issue's sources from its links", () => {
    const t = text(inProvider(createElement(LinkedSources, { target: { kind: "issue", issueId: I1 }, label: "Issue #1" })));
    expect(t).toContain("Strategy walkthrough");
    expect(t).not.toContain("Sales team notes");
  });

  it("has no + Link or remove button for a viewer, but still lists the sources", () => {
    const html = inProvider(stepBlock, "readonly");
    expect(html).not.toContain(">+ Link</button>");
    expect(html).not.toContain("Remove link");
    expect(text(html)).toContain("Strategy walkthrough");
  });

  it("draws nothing on a screen that doesn't load source links", () => {
    expect(renderToStaticMarkup(stepBlock)).toBe("");
  });

  it("has its (i) texts, in plain English", () => {
    const html = inProvider(stepBlock);
    expect(html).toContain("About Sources");
    expect(html).toContain("About Link a source");
    for (const h of Object.values(LINKED_SOURCES_HELP)) {
      expect(h.description.length).toBeGreaterThan(30);
      expect(h.example.length).toBeGreaterThan(8);
      expect(`${h.description} ${h.example}`).not.toMatch(/\b(RLS|jsonb|payload|enum|schema|FK|provenance)\b/i);
    }
  });
});

describe("what the dialog may pick when a screen opens it", () => {
  it("adds the thing it was opened for when the page's lists don't have it (an insight no one has acknowledged, a step just added)", () => {
    const insight = withTarget(targets, { target: { kind: "insight", insightKey: KEY }, label: "Insight: The queue keeps growing" });
    expect(insight.insights).toEqual([{ key: KEY, title: "The queue keeps growing" }]);
    const step = withTarget(targets, { target: { kind: "step", processId: P1, stepId: "e0000000-0000-4000-8000-0000000000aa" }, label: "Step: New step" });
    expect(step.steps.map((s) => s.name)).toEqual(["Audit & proposal", "New step"]);
  });

  it("leaves the lists as they were when they have it, and when nothing is open", () => {
    expect(withTarget(targets, { target: { kind: "step", processId: P1, stepId: S1 }, label: "Step: Audit & proposal" })).toBe(targets);
    expect(withTarget(targets, { target: { kind: "issue", issueId: I1 }, label: "Issue #1" })).toBe(targets);
    expect(withTarget(targets, null)).toBe(targets);
  });

  it("asks for a source when linking an existing one without picking", () => {
    expect(NEEDS_A_SOURCE).toBe("Pick a source.");
  });
});

describe("the step detail", () => {
  const step = { id: S1, process_id: P1, name: "Audit & proposal", work_hours: 6, wait_hours: 0, provenance: {} } as never;
  const detail = (sourcesProp: string[]) => createElement(StepDetail, { step, who: "Maya", rating: null, extras: { insights: [], issues: [] }, sources: sourcesProp, onClose: () => {} });

  it("lists the step's linked sources with + Link where the page loads links, and the cited titles where it doesn't", () => {
    const withLinks = text(inProvider(detail(["A cited one"])));
    expect(withLinks).toContain("Strategy walkthrough");
    expect(withLinks).toContain("+ Link");
    expect(withLinks).not.toContain("A cited one");
    const without = text(renderToStaticMarkup(detail(["A cited one"])));
    expect(without).toContain("A cited one");
    expect(without).not.toContain("+ Link");
  });
});

describe("every screen has it", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");

  it("shows <LinkedSources> on the step detail, the Editor inspector, the insight pop-up, the issue page and the process page, each for its own kind", () => {
    expect(read("components/map/step-detail.tsx")).toMatch(/<LinkedSources[\s\S]*?kind: "step"/);
    expect(read("components/editor/inspector.tsx")).toMatch(/<LinkedSources[\s\S]*?kind: "step"/);
    expect(read("components/insights.tsx")).toMatch(/<LinkedSources target=\{\{ kind: "insight"/);
    expect(read("components/issues/issue-page.tsx")).toMatch(/<LinkedSources[\s\S]*?kind: "issue"/);
    expect(read("components/process-page.tsx")).toMatch(/<LinkedSources target=\{\{ kind: "process"/);
  });

  it("loads the links on each of those pages, and on the demo for all of them", () => {
    for (const f of ["components/workspace-process-page.tsx", "components/editor/workspace-editor-page.tsx", "components/overview/workspace-overview.tsx", "app/w/[slug]/issues/[number]/page.tsx"]) {
      expect(read(f), f).toContain("<SourceLinkingScope");
    }
    expect(read("app/demo/layout.tsx")).toContain("<DemoSourceLinkingScope");
  });

  it("leaves the solution page for A50 with a note, since it isn't built yet", () => {
    expect(read("components/sources/linking.tsx")).toContain("TODO(A50)");
  });
});
