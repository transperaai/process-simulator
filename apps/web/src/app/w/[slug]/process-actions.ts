"use server";

import { redirect } from "next/navigation";
import { isId } from "@/lib/editor/validate";
import { createClient } from "@/lib/supabase/server";

// Creating a process from the app (issues #19, #76). The process row is
// written directly (processes aren't revisioned); its first steps go into a
// draft opened with open_draft, as every signed-in edit does (the database's
// edit_drafts_only trigger refuses the rest). It opens on the canvas in Draft
// view, unpublished until someone publishes it.

export interface CreateProcessResult {
  error?: string;
}

const MAX_NAME = 120;

export async function createServicingProcess(workspaceId: string, slug: string, _prev: CreateProcessResult, form: FormData): Promise<CreateProcessResult> {
  const name = String(form.get("name") ?? "").trim();
  if (!isId(workspaceId) || typeof slug !== "string") return { error: "Couldn't create it. Try again." };
  if (!name || name.length > MAX_NAME) return { error: `Give it a name (up to ${MAX_NAME} characters).` };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Your session has ended. Sign in again." };

  const { data: existing } = await supabase.from("processes").select("name").eq("workspace_id", workspaceId);
  if ((existing ?? []).some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) return { error: `There is already a process called '${name}'.` };

  const { data: proc, error } = await supabase
    .from("processes")
    .insert({ workspace_id: workspaceId, name, kind: "servicing", entity_name: "task", source: "manual" })
    .select("id")
    .single();
  if (error || !proc) {
    return { error: error?.code === "42501" ? "You don't have permission to add processes here." : "Couldn't create it. Try again." };
  }
  const { data: opened, error: openError } = await supabase.rpc("open_draft", { target_process: proc.id });
  const draft = opened as { status: string; revision_id?: string } | null;
  if (openError || draft?.status !== "ok" || !draft.revision_id) return { error: "Created it, but couldn't open a draft. Open it from the list." };

  // A start and a done end, joined, to build on.
  const start = crypto.randomUUID();
  const end = crypto.randomUUID();
  const base = { revision_id: draft.revision_id, workspace_id: workspaceId, process_id: proc.id };
  const { error: stepError } = await supabase.from("steps").insert([
    { ...base, id: start, name: "Task due", kind: "start", x: 60, y: 60 },
    { ...base, id: end, name: "Done", kind: "end", outcome: "done", x: 520, y: 60 },
  ]);
  if (!stepError) {
    await supabase.from("edges").insert({ ...base, from_step_id: start, to_step_id: end, probability: 1 });
  }
  redirect(`/w/${encodeURIComponent(slug)}/p/${proc.id}/edit`);
}
