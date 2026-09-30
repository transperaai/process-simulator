"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseNewWorkspace } from "@/lib/workspaces";

// Creating a workspace from the home page (issue #88; docs/adr/0012-*). Only
// agency admins may: `create_workspace` checks that in the database, as the
// signed-in user, and gives the creator an agency_admin membership.

export interface CreateWorkspaceState {
  error?: string;
}

export async function createWorkspace(_prev: CreateWorkspaceState, form: FormData): Promise<CreateWorkspaceState> {
  const parsed = parseNewWorkspace(form);
  if ("error" in parsed) return parsed;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Your session has ended. Sign in again." };

  const { error } = await supabase.rpc("create_workspace", { ws_name: parsed.name, ws_slug: parsed.slug, ws_settings: parsed.settings });
  if (error) {
    if (error.code === "42501") return { error: "Only agency admins can create workspaces." };
    if (error.code === "23505") return { error: `The address /w/${parsed.slug} is already taken. Choose another.` };
    if (error.code === "23514" || error.code === "22023") return { error: "Some of those values aren't allowed." };
    return { error: "Couldn't create it. Try again." };
  }
  // redirect throws, so it stays outside any try.
  redirect(`/w/${encodeURIComponent(parsed.slug)}`);
}
