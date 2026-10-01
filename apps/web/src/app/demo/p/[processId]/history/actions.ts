"use server";

import type { DuplicateResult, RestoreResult } from "@/app/w/[slug]/p/[processId]/history/actions";

// The demo keeps nothing (there is no database), so Restore and Duplicate say so instead of pretending.

export async function demoRestore(): Promise<RestoreResult> {
  return { status: "error", message: "Demo mode: nothing is saved here, so Restore is switched off. In a workspace it copies the version into your draft." };
}

export async function demoDuplicate(): Promise<DuplicateResult> {
  return { status: "error", message: "Demo mode: nothing is saved here, so Duplicate is switched off. In a workspace it starts a new process from the version." };
}
