import { describe, expect, it } from "vitest";
import { demoNav, workspaceNav, type NavItem } from "@/lib/shell/nav";

// The sidebar's items and which one is active (issue #93).

const nav = (pathname: string, over: Partial<Parameters<typeof workspaceNav>[0]> = {}) =>
  workspaceNav({ slug: "s", pathname, canEdit: true, canManage: true, pendingSuggestions: 0, ...over });
const active = (items: NavItem[]) => items.filter((i) => i.active).map((i) => i.key);
const item = (items: NavItem[], key: string) => items.find((i) => i.key === key);
const PID = "0d5f6f0e-0000-4000-8000-000000000001";

describe("workspaceNav: the active item", () => {
  it("is Map on the workspace root", () => expect(active(nav("/w/s"))).toEqual(["map"]));
  it("is Map on a process page", () => expect(active(nav(`/w/s/p/${PID}`))).toEqual(["map"]));
  it("is Runs on a run page", () => expect(active(nav("/w/s/runs/abc"))).toEqual(["runs"]));
  it("is Runs on the runs list", () => expect(active(nav("/w/s/runs"))).toEqual(["runs"]));
  it("is Settings on exactly /settings", () => expect(active(nav("/w/s/settings"))).toEqual(["settings"]));
  it("is Access, not Settings, on /settings/access", () => expect(active(nav("/w/s/settings/access"))).toEqual(["access"]));
  it("is Report on report pages", () => {
    expect(active(nav("/w/s/reports"))).toEqual(["report"]);
    expect(active(nav("/w/s/reports/r1"))).toEqual(["report"]);
  });
  it("is Suggestions, Sources, Clients and Issues on their pages", () => {
    expect(active(nav("/w/s/suggestions"))).toEqual(["suggestions"]);
    expect(active(nav("/w/s/sources"))).toEqual(["sources"]);
    expect(active(nav("/w/s/clients"))).toEqual(["clients"]);
    expect(active(nav("/w/s/issues"))).toEqual(["issues"]);
  });
  it("never marks People or Scenarios, which are places within pages", () => {
    for (const p of ["/w/s", "/w/s/settings", `/w/s/p/${PID}`]) {
      expect(item(nav(p), "people")?.active).toBe(false);
      expect(item(nav(p), "scenarios")?.active).toBe(false);
    }
  });
  it("does not confuse another workspace with a prefix of this one", () => expect(active(nav("/w/s2/runs"))).toEqual([]));
});

describe("workspaceNav: items and hrefs", () => {
  it("hides Report unless the viewer can edit", () => {
    expect(item(nav("/w/s", { canEdit: false }), "report")).toBeUndefined();
    expect(item(nav("/w/s"), "report")).toBeDefined();
  });
  it("carries the process on Report from a process page only", () => {
    expect(item(nav(`/w/s/p/${PID}`), "report")?.href).toBe(`/w/s/reports?process=${PID}`);
    expect(item(nav("/w/s"), "report")?.href).toBe("/w/s/reports");
    expect(item(nav("/w/s/runs"), "report")?.href).toBe("/w/s/reports");
  });
  it("shows Access only to managers", () => {
    expect(item(nav("/w/s", { canManage: false }), "access")).toBeUndefined();
    expect(item(nav("/w/s"), "access")?.href).toBe("/w/s/settings/access");
  });
  it("points People at the people section of Settings", () => expect(item(nav("/w/s"), "people")?.href).toBe("/w/s/settings#people-heading"));
  it("sends Scenarios to the map's panel: the current map path on a map, else the workspace with ?panel", () => {
    expect(item(nav(`/w/s/p/${PID}`), "scenarios")).toMatchObject({ href: `/w/s/p/${PID}`, panel: "scenarios" });
    expect(item(nav("/w/s"), "scenarios")).toMatchObject({ href: "/w/s", panel: "scenarios" });
    expect(item(nav("/w/s/runs"), "scenarios")).toMatchObject({ href: "/w/s?panel=scenarios", panel: "scenarios" });
  });
  it("counts pending suggestions", () => expect(item(nav("/w/s", { pendingSuggestions: 3 }), "suggestions")?.count).toBe(3));
  it("lists Settings and Access last, for the bottom group", () => {
    const keys = nav("/w/s").map((i) => i.key);
    expect(keys.slice(-2)).toEqual(["settings", "access"]);
  });
});

describe("demoNav", () => {
  const d = (pathname: string, pendingSuggestions = 2) => demoNav({ pathname, pendingSuggestions });
  it("lists Northbeam's items, without People, Settings or Access", () => {
    expect(d("/demo").map((i) => i.key)).toEqual(["map", "issues", "clients", "scenarios", "suggestions", "sources", "runs", "report"]);
  });
  it("marks the active page", () => {
    expect(active(d("/demo"))).toEqual(["map"]);
    expect(active(d("/demo/clients"))).toEqual(["clients"]);
    expect(active(d("/demo/runs"))).toEqual(["runs"]);
    expect(active(d("/demo/suggestions"))).toEqual(["suggestions"]);
  });
  it("opens Issues and Scenarios as panels of the demo map", () => {
    expect(item(d("/demo"), "issues")).toMatchObject({ href: "/demo?panel=issues", panel: "issues" });
    expect(item(d("/demo"), "scenarios")).toMatchObject({ href: "/demo?panel=scenarios", panel: "scenarios" });
  });
  it("counts the seed's pending suggestions", () => expect(item(d("/demo"), "suggestions")?.count).toBe(2));
  it("shows only Map, Issues and Scenarios on Larkspur", () => {
    const items = d("/demo/larkspur");
    expect(items.map((i) => i.key)).toEqual(["map", "issues", "scenarios"]);
    expect(active(items)).toEqual(["map"]);
    expect(items.map((i) => i.href)).toEqual(["/demo/larkspur", "/demo/larkspur?panel=issues", "/demo/larkspur?panel=scenarios"]);
  });
});
