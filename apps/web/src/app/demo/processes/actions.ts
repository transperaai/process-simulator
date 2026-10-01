"use server";

import { bundleForProcess, northbeamIssues } from "@transpera-flow/db";
import type { ProcessCardData } from "@/lib/processes/data";
import { demoBundle } from "@/lib/sources/demo";

/** A row's map card on the demo: Northbeam's process at its sample revision. */
export async function openDemoProcessCard(processId: string): Promise<ProcessCardData | null> {
  if (typeof processId !== "string") return null;
  const bundle = bundleForProcess(demoBundle(), processId);
  if (!bundle) return null;
  return { bundle, issues: northbeamIssues().filter((i) => i.process_id === processId) };
}
