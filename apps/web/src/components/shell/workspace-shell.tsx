"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar, type ShellProps } from "./app-sidebar";
import { MapPanelRequestProvider } from "./map-panel-request";

/** The frame around every page of a workspace and of the demo (issue #93): the sidebar, and the page as its `<main>`. */
export function WorkspaceShell({ defaultOpen, children, ...sidebar }: ShellProps & { defaultOpen: boolean; children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <TooltipProvider delayDuration={300}>
        <MapPanelRequestProvider>
          <AppSidebar {...sidebar} />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </MapPanelRequestProvider>
      </TooltipProvider>
      {/* The sidebar's Sign out submits this. */}
      {sidebar.mode === "live" && <form id="sign-out" action="/auth/signout" method="post" hidden />}
    </SidebarProvider>
  );
}
