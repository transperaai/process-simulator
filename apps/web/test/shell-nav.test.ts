import { describe, expect, it } from "vitest";
import { demoNav, workspaceNav, type NavItem } from "@/lib/shell/nav";

// The sidebar's items and which one is active (issue #93).

const nav = (pathname: string, over: Partial<Parameters<typeof workspaceNav>[0]> = {}) =>
  workspaceNav({ slug: "s", pathname, canManage: true, pendingSuggestions: 0, ...over });
const active = (items: NavItem[]) => items.filter((i) => i.active).map((i) => i.key);
const item = (items: NavItem[], key: string) => items.find((i) => i.key === key);
const PID = "0d5f6f0e-0000-4000-8000-000000000001";

describe("workspaceNav: the active item", () => {
  it("is Map on the workspace root", () => expect(active(nav("/w/s"))).toEqual(["map"]));
  it("is Map on a process page", () => expect(active(nav(`/w/s/p/${PID}`))).toEqual(["map"]));
  it("is Settings on exactly /settings", () => expect(active(nav("/w/s/settings"))).toEqual(["settings"]));
  it("is Access, not Settings, on /settings/access", () => expect(active(nav("/w/s/settings/access"))).toEqual(["access"]));
  it("is Suggestions, Sources and Issues on their pages", () => {
    expect(active(nav("/w/s/suggestions"))).toEqual(["suggestions"]);
    expect(active(nav("/w/s/sources"))).toEqual(["sources"]);
    expect(active(nav("/w/s/issues"))).toEqual(["issues"]);
  });
  it("never marks People, which is a place within a page", () => {
    for (const p of ["/w/s", "/w/s/settings", `/w/s/p/${PID}`]) expect(item(nav(p), "people")?.active).toBe(false);
  });
  it("does not confuse another workspace with a prefix of this one", () => expect(active(nav("/w/s2/issues"))).toEqual([]));
});

describe("workspaceNav: items and hrefs", () => {
  it("has no Reports, Clients, Scenarios or Runs items", () => {
    const keys = nav("/w/s").map((i) => i.key);
    for (const gone of ["report", "clients", "scenarios", "runs"]) expect(keys).not.toContain(gone);
    expect(nav("/w/s").map((i) => i.href).filter((h) => /\/(reports|clients|runs)\b|panel=scenarios/.test(h))).toEqual([]);
  });
  it("shows Access only to managers", () => {
    expect(item(nav("/w/s", { canManage: false }), "access")).toBeUndefined();
    expect(item(nav("/w/s"), "access")?.href).toBe("/w/s/settings/access");
  });
  it("points People at the people section of Settings", () => expect(item(nav("/w/s"), "people")?.href).toBe("/w/s/settings#people-heading"));
  it("counts pending suggestions", () => expect(item(nav("/w/s", { pendingSuggestions: 3 }), "suggestions")?.count).toBe(3));
  it("lists Settings and Access last, for the bottom group", () => {
    const keys = nav("/w/s").map((i) => i.key);
    expect(keys.slice(-2)).toEqual(["settings", "access"]);
  });
});

describe("demoNav", () => {
  const d = (pathname: string, pendingSuggestions = 2) => demoNav({ pathname, pendingSuggestions });
  it("lists Northbeam's items, without People, Settings or Access", () => {
    expect(d("/demo").map((i) => i.key)).toEqual(["map", "issues", "suggestions", "sources"]);
  });
  it("marks the active page", () => {
    expect(active(d("/demo"))).toEqual(["map"]);
    expect(active(d("/demo/suggestions"))).toEqual(["suggestions"]);
  });
  it("opens Issues as a panel of the demo map", () => {
    expect(item(d("/demo"), "issues")).toMatchObject({ href: "/demo?panel=issues", panel: "issues" });
  });
  it("counts the seed's pending suggestions", () => expect(item(d("/demo"), "suggestions")?.count).toBe(2));
  it("shows only Map and Issues on Larkspur", () => {
    const items = d("/demo/larkspur");
    expect(items.map((i) => i.key)).toEqual(["map", "issues"]);
    expect(active(items)).toEqual(["map"]);
    expect(items.map((i) => i.href)).toEqual(["/demo/larkspur", "/demo/larkspur?panel=issues"]);
  });
});
