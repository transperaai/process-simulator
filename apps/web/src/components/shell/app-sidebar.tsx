"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, CircleAlert, FileText, Inbox, KeyRound, LogOut, Settings, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { BOTTOM_KEYS, demoNav, workspaceNav, type NavIcon, type NavItem } from "@/lib/shell/nav";
import { useMapPanelRequest } from "./map-panel-request";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "./workspace-switcher";

const ICONS: Record<NavIcon, LucideIcon> = {
  map: Workflow,
  issues: CircleAlert,
  people: Users,
  suggestions: Inbox,
  sources: FileText,
  settings: Settings,
  access: ShieldCheck,
};

export type ShellProps =
  | {
      mode: "live";
      slug: string;
      workspaceName: string;
      workspaces: SwitcherWorkspace[];
      canManage: boolean;
      pendingSuggestions: number;
      viewer: { name: string; email: string | null } | null;
    }
  | { mode: "demo"; pendingSuggestions: number };

export function AppSidebar(props: ShellProps) {
  const pathname = usePathname();
  const { requestPanel } = useMapPanelRequest();
  const { isMobile, setOpenMobile } = useSidebar();
  const items =
    props.mode === "live"
      ? workspaceNav({ slug: props.slug, pathname, canManage: props.canManage, pendingSuggestions: props.pendingSuggestions })
      : demoNav({ pathname, pendingSuggestions: props.pendingSuggestions });
  const main = items.filter((i) => !BOTTOM_KEYS.includes(i.key));
  const bottom = items.filter((i) => BOTTOM_KEYS.includes(i.key));
  const larkspur = props.mode === "demo" && (pathname === "/demo/larkspur" || pathname.startsWith("/demo/larkspur/"));
  // On a map route the Issues item opens the map's panel instead of loading the page again.
  const onMapRoute = main.find((i) => i.key === "map")?.active ?? false;

  const item = (i: NavItem) => {
    const Icon = ICONS[i.icon];
    return (
      <SidebarMenuItem key={i.key}>
        <SidebarMenuButton asChild isActive={i.active} tooltip={i.count ? `${i.label} · ${i.count} pending` : i.label}>
          <Link
            href={i.href}
            aria-current={i.active ? "page" : undefined}
            onClick={(e) => {
              if (i.panel && onMapRoute) {
                e.preventDefault();
                requestPanel(i.panel);
              }
              if (isMobile) setOpenMobile(false);
            }}
          >
            <Icon />
            <span>{i.label}</span>
          </Link>
        </SidebarMenuButton>
        {i.count !== undefined && i.count > 0 && (
          <SidebarMenuBadge aria-label={`${i.label}, ${i.count} pending`} className="border border-warn bg-warn-soft text-fg tabular-nums">
            {i.count}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {props.mode === "live" ? (
          <WorkspaceSwitcher current={props.workspaceName} workspaces={props.workspaces} />
        ) : (
          <WorkspaceSwitcher
            current={larkspur ? "Larkspur Creative" : "Northbeam Digital"}
            workspaces={[
              { name: "Northbeam Digital", href: "/demo" },
              { name: "Larkspur Creative", href: "/demo/larkspur" },
            ]}
          />
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{main.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {bottom.length > 0 && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>{bottom.map(item)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        {props.mode === "live" ? (
          <NavUser viewer={props.viewer} />
        ) : (
          <Badge variant="outline" className="w-full justify-start rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
            Demo · sample data{larkspur ? ", read-only" : ""}
          </Badge>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** The signed-in person at the foot of the sidebar: their token page and Sign out. */
function NavUser({ viewer }: { viewer: { name: string; email: string | null } | null }) {
  const { isMobile } = useSidebar();
  const name = viewer?.name ?? "Account";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-muted" aria-label={`Account: ${name}`}>
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-fg">
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium text-fg">{name}</span>
                {viewer?.email && <span className="truncate text-2xs text-muted-foreground">{viewer.email}</span>}
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" align="end" side={isMobile ? "bottom" : "right"} sideOffset={8}>
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium text-fg">{name}</span>
              {viewer?.email && <span className="block truncate text-xs text-muted-foreground">{viewer.email}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/tokens">
                <KeyRound /> API tokens
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (document.getElementById("sign-out") as HTMLFormElement | null)?.requestSubmit()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
