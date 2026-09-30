// The sidebar's items and where they go (issue #93). Pure, so the mapping from a pathname to the
// active item is unit-tested; the sidebar component only renders what this returns.

export type NavIcon = "map" | "issues" | "clients" | "people" | "scenarios" | "suggestions" | "sources" | "runs" | "report" | "settings" | "access";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** A count shown as a badge (pending suggestions). */
  count?: number;
  /** On a map route, this item opens that tab of the map's side panel instead of navigating. */
  panel?: "scenarios" | "issues";
  icon: NavIcon;
}

/** Settings and Access sit apart from the rest, at the bottom of the sidebar. */
export const BOTTOM_KEYS: readonly string[] = ["settings", "access"];

const PROCESS_ID = /^\/p\/([^/?#]+)/;

export function workspaceNav({
  slug,
  pathname,
  canEdit,
  canManage,
  pendingSuggestions,
}: {
  slug: string;
  pathname: string;
  canEdit: boolean;
  canManage: boolean;
  pendingSuggestions: number;
}): NavItem[] {
  const base = `/w/${slug}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const onMap = pathname === base || rest.startsWith("/p/");
  const process = onMap ? rest.match(PROCESS_ID)?.[1] : undefined;
  const at = (path: string) => rest === path || rest.startsWith(`${path}/`);
  const main: NavItem[] = [
    { key: "map", label: "Map", href: base, active: onMap, icon: "map" },
    { key: "issues", label: "Issues", href: `${base}/issues`, active: at("/issues"), icon: "issues" },
    { key: "clients", label: "Clients", href: `${base}/clients`, active: at("/clients"), icon: "clients" },
    { key: "people", label: "People", href: `${base}/settings#people-heading`, active: false, icon: "people" },
    { key: "scenarios", label: "Scenarios", href: onMap ? pathname : `${base}?panel=scenarios`, active: false, panel: "scenarios", icon: "scenarios" },
    { key: "suggestions", label: "Suggestions", href: `${base}/suggestions`, active: at("/suggestions"), count: pendingSuggestions, icon: "suggestions" },
    { key: "sources", label: "Sources", href: `${base}/sources`, active: at("/sources"), icon: "sources" },
    { key: "runs", label: "Runs", href: `${base}/runs`, active: at("/runs"), icon: "runs" },
  ];
  if (canEdit) {
    main.push({ key: "report", label: "Report", href: `${base}/reports${process ? `?process=${process}` : ""}`, active: at("/reports"), icon: "report" });
  }
  const bottom: NavItem[] = [{ key: "settings", label: "Settings", href: `${base}/settings`, active: rest === "/settings", icon: "settings" }];
  if (canManage) bottom.push({ key: "access", label: "Access", href: `${base}/settings/access`, active: at("/settings/access"), icon: "access" });
  return [...main, ...bottom];
}

export function demoNav({ pathname, pendingSuggestions }: { pathname: string; pendingSuggestions: number }): NavItem[] {
  if (pathname === "/demo/larkspur" || pathname.startsWith("/demo/larkspur/")) {
    const base = "/demo/larkspur";
    return [
      { key: "map", label: "Map", href: base, active: true, icon: "map" },
      { key: "issues", label: "Issues", href: `${base}?panel=issues`, active: false, panel: "issues", icon: "issues" },
      { key: "scenarios", label: "Scenarios", href: `${base}?panel=scenarios`, active: false, panel: "scenarios", icon: "scenarios" },
    ];
  }
  const at = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  return [
      { key: "map", label: "Map", href: "/demo", active: pathname === "/demo", icon: "map" },
      { key: "issues", label: "Issues", href: "/demo?panel=issues", active: false, panel: "issues", icon: "issues" },
      { key: "clients", label: "Clients", href: "/demo/clients", active: at("/demo/clients"), icon: "clients" },
      { key: "scenarios", label: "Scenarios", href: "/demo?panel=scenarios", active: false, panel: "scenarios", icon: "scenarios" },
      { key: "suggestions", label: "Suggestions", href: "/demo/suggestions", active: at("/demo/suggestions"), count: pendingSuggestions, icon: "suggestions" },
      { key: "sources", label: "Sources", href: "/demo/sources", active: at("/demo/sources"), icon: "sources" },
      { key: "runs", label: "Runs", href: "/demo/runs", active: at("/demo/runs"), icon: "runs" },
      { key: "report", label: "Report", href: "/demo/report", active: at("/demo/report"), icon: "report" },
  ];
}
