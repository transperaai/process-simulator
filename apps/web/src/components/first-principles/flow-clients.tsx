"use client";

// The first-principles flow wired to where answers are kept (issue #119): a workspace saves through a Server Action
// into the process's draft; the public demo keeps them in memory in this tab.

import type { ComponentProps } from "react";
import { saveFirstPrinciplesAction } from "@/app/w/[slug]/p/[processId]/first-principles/actions";
import { getDemoFirstPrinciples, setDemoFirstPrinciples } from "@/lib/first-principles/demo-store";
import type { FpSaver } from "@/lib/first-principles/types";
import { FirstPrinciplesFlow } from "./first-principles-flow";

type FlowProps = ComponentProps<typeof FirstPrinciplesFlow>;

export function WorkspaceFirstPrinciplesFlow({ workspaceId, processId, ...props }: Omit<FlowProps, "save"> & { workspaceId: string; processId: string }) {
  const save: FpSaver = (doc, base) => saveFirstPrinciplesAction(workspaceId, processId, doc, base.version, base.revisionId);
  return <FirstPrinciplesFlow {...props} save={save} />;
}

export function DemoFirstPrinciplesFlow({ processId, ...props }: Omit<FlowProps, "save" | "initial" | "base" | "canEdit" | "editing"> & { processId: string }) {
  const save: FpSaver = async (doc) => {
    setDemoFirstPrinciples(processId, doc);
    return { status: "saved", version: null, revisionId: null };
  };
  return <FirstPrinciplesFlow {...props} initial={getDemoFirstPrinciples(processId)} base={{ version: null, revisionId: null }} canEdit editing={{ kind: "demo" }} save={save} />;
}
