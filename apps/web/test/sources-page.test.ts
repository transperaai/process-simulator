import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type SourceLinkRow } from "@transpera-flow/db";
import { SourcesPage } from "@/components/sources-page";
import { LINK_HELP } from "@/components/sources/link-chips";
import { SOURCE_DIALOG_HELP } from "@/components/sources/source-dialog";
import { demoBundle, demoCitations, demoLinkTargets, demoPageSources, demoSourceLinks, DEMO_UNLINKED_SOURCE_ID } from "@/lib/sources/demo";
import { demoNav, flatItems, workspaceNav } from "@/lib/shell/nav";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/demo/sources", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/w/[slug]/source-actions", () => ({
  createSource: async () => ({ status: "error", message: "" }),
  saveSourceField: async () => ({ status: "error", message: "" }),
  deleteSource: async () => ({ status: "error", message: "" }),
  linkSource: async () => ({ status: "error", message: "" }),
  unlinkSource: async () => ({ status: "error", message: "" }),
}));

// The Sources page (issue #118, A53): each source with its title, type, date, quote and links as chips, "+ Link", a warning
// on one that is linked to nothing, the sidebar's count, and an (i) on every setting and rule on the screen.

const bundle = demoBundle();
const page = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(SourcesPage, {
      workspaceId: bundle.workspace.id,
      sources: demoPageSources(),
      citations: demoCitations(bundle),
      links: demoSourceLinks(),
      targets: demoLinkTargets(bundle),
      mode: "demo",
      processBase: "/demo/p",
      ...over,
    }),
  );
/** The markup of one source's card. */
const card = (html: string, title: string) => new RegExp(`<article aria-label="${title}"[\\s\\S]*?</article>`).exec(html)![0];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the Sources page", () => {
  const html = page();

  it("lists each source with its title, type, date and quote", () => {
    const interview = card(html, "Strategy walkthrough");
    expect(interview).toContain("Transcript");
    expect(interview).toContain("2026-09-12");
    expect(text(interview)).toContain("“[00:14:05] Maya Collins: A proper audit and proposal is a day's work");
    const notes = card(html, "Notes: ops walkthrough with Leah");
    expect(notes).toContain("Notes");
    expect(text(notes)).toContain("“Access requests go back and forth for about a week on most new clients.”");
  });

  it("shows a source's links as chips, named by what they are", () => {
    const interview = card(html, "Strategy walkthrough");
    expect(interview).toContain('aria-label="Linked to"');
    expect(text(interview)).toContain("Step: Audit & proposal");
    expect(text(interview)).toMatch(/Issue #\d+/);
    // Two links make two chips, each removable.
    expect((interview.match(/data-link-kind=/g) ?? []).length).toBe(demoSourceLinks().filter((l) => l.source_id === "30000000-0000-4000-8000-000000000001").length);
    expect(interview).toContain("Remove link: Step: Audit");
  });

  it("has a + Link on every source and a + Add source at the top", () => {
    expect((html.match(/>\+ Link<\/button>/g) ?? []).length).toBe(demoPageSources().length);
    expect(html).toContain("+ Add source");
    expect(html).toContain("Link Strategy walkthrough to something");
  });

  it("flags a source that is linked to nothing, in the prototype's words, and only that one", () => {
    const warning = "Not linked to anything yet. Link it, or it won't count as evidence.";
    expect(text(card(html, "Notes: ops walkthrough with Leah"))).toContain(warning);
    expect(text(card(html, "Strategy walkthrough"))).not.toContain(warning);
    expect(text(card(html, "Sales team notes"))).not.toContain(warning);
    expect((html.match(/data-unlinked(?!-)/g) ?? []).length).toBe(1);
    expect(text(html)).toContain("1 source isn't linked to anything yet.");
  });

  it("flags every source when none is linked, and none when all are", () => {
    const none = page({ links: [] });
    expect((none.match(/data-unlinked(?!-)/g) ?? []).length).toBe(demoPageSources().length);
    expect(text(none)).toContain("3 sources aren't linked to anything yet.");
    const sources = demoPageSources();
    const links: SourceLinkRow[] = sources.map((s, i) => ({ ...demoSourceLinks()[0]!, id: `x${i}`, source_id: s.id }));
    const all = page({ links });
    expect(all).not.toContain("data-unlinked");
    expect(all).not.toContain("aren't linked");
  });

  it("is read-only for a viewer: no + Add source, no + Link, no way to remove a link", () => {
    const view = page({ mode: "readonly" });
    expect(view).not.toContain("+ Add source");
    expect(view).not.toContain(">+ Link</button>");
    expect(view).not.toContain("Remove link");
    expect(text(view)).toContain("You can read the sources here");
    // The warning and the chips still show.
    expect(text(view)).toContain("Not linked to anything yet");
    expect(view).toContain('aria-label="Linked to"');
  });

  it("says what to do when there are no sources", () => {
    expect(text(page({ sources: [], links: [], citations: {} }))).toContain("No sources yet. Add the audit's transcripts and notes and link each one");
  });

  it("gives the linked sources' (i) and the warning's", () => {
    expect(html).toContain(`About ${LINK_HELP.linked.label}`);
    expect(html).toContain(`About ${LINK_HELP.unlinked.label}`);
  });
});

describe("the sidebar's count", () => {
  it("counts the sources linked to nothing beside Sources, as a warning", () => {
    const counts = { unlinkedSources: 1 };
    for (const groups of [demoNav({ pathname: "/demo/sources", counts }), workspaceNav({ slug: "s", pathname: "/w/s/sources", canManage: false, counts })]) {
      const sources = flatItems(groups).find((i) => i.key === "sources")!;
      expect(sources).toMatchObject({ count: 1, tone: "warn", countNoun: "not linked to anything", active: true });
    }
  });

  it("matches the demo's sample: one source is unlinked", () => {
    expect(demoPageSources().filter((s) => !demoSourceLinks().some((l) => l.source_id === s.id)).map((s) => s.id)).toEqual([DEMO_UNLINKED_SOURCE_ID]);
    const layout = readFileSync(join(__dirname, "..", "src/app/demo/layout.tsx"), "utf8");
    expect(layout).toContain("unlinkedSources: unlinkedSources(demoPageSources(), demoSourceLinks()).length");
    const live = readFileSync(join(__dirname, "..", "src/app/w/[slug]/layout.tsx"), "utf8");
    expect(live).toContain("unlinkedSources: shell.unlinkedSources");
  });
});

describe("help on the Sources screen", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");
  const dialog = read("components/sources/source-dialog.tsx");
  const chips = read("components/sources/link-chips.tsx");

  it("has a description and an example for every control and rule", () => {
    expect(Object.keys(SOURCE_DIALOG_HELP).sort()).toEqual(["date", "existing", "kind", "quote", "target", "title", "type"]);
    for (const [key, help] of [...Object.entries(SOURCE_DIALOG_HELP), ...Object.entries(LINK_HELP)]) {
      expect(help.label.length, key).toBeGreaterThan(2);
      expect(help.description.length, `${key} description`).toBeGreaterThan(30);
      expect(help.example.length, `${key} example`).toBeGreaterThan(8);
    }
  });

  it("shows an (i) beside each of them", () => {
    for (const key of Object.keys(SOURCE_DIALOG_HELP)) {
      expect(dialog.includes(`help={SOURCE_DIALOG_HELP.${key}}`) || dialog.includes(`<Help {...SOURCE_DIALOG_HELP.${key}} />`), `${key} has no (i) in the dialog`).toBe(true);
    }
    expect(chips).toContain("<Help {...LINK_HELP.unlinked} />");
    expect(chips).toContain("<Help {...LINK_HELP.linked} />");
  });

  it("asks the questions the prototype does, in its words", () => {
    for (const label of ["Title", "Type", "Date", "Quote or excerpt", "Link it to (required)"]) expect(Object.values(SOURCE_DIALOG_HELP).map((h) => h.label)).toContain(label);
    expect(dialog).toContain("Add source");
    expect(dialog).toContain("Link source");
  });

  it("keeps to plain English: no jargon words", () => {
    for (const help of [...Object.values(SOURCE_DIALOG_HELP), ...Object.values(LINK_HELP)]) {
      expect(`${help.description} ${help.example}`).not.toMatch(/\b(RLS|jsonb|payload|enum|schema|FK|provenance|foreign key)\b/i);
    }
  });
});
