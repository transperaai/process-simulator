import { listProcesses, type Db, type ProcessRow } from "@transpera-flow/db";
import type { ReportExporter } from "./report-tool";
import { ToolError } from "./result";

/** Per-request state: a Supabase client acting as the token's user, and which token it is. */
export interface ToolContext {
  db: Db;
  tokenHash: string;
  /** The token's active workspace (set_active_workspace), if any. */
  activeWorkspaceId: string | null;
  /** ISO date used when a tool needs "today". */
  today: string;
  /** The report pipeline (export_report), supplied by the web app; absent where it can't run. */
  reports?: ReportExporter;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  settings: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** Workspaces the user can see; RLS decides. */
export async function visibleWorkspaces(db: Db): Promise<WorkspaceRef[]> {
  return check(await db.from("workspaces").select("id, name, slug, settings").order("name"));
}

const summary = (w: WorkspaceRef) => ({ id: w.id, name: w.name, slug: w.slug });

/** Find one workspace by id, slug or name (case-insensitive) among those visible. */
export function matchWorkspace(workspaces: WorkspaceRef[], ref: string): WorkspaceRef {
  const needle = ref.trim().toLowerCase();
  const exact = workspaces.filter(
    (w) => (UUID.test(needle) && w.id === needle) || w.slug === needle || w.name.toLowerCase() === needle,
  );
  if (exact.length === 1) return exact[0]!;
  const partial = workspaces.filter((w) => w.name.toLowerCase().includes(needle) || w.slug.includes(needle));
  if (exact.length === 0 && partial.length === 1) return partial[0]!;
  const candidates = (exact.length ? exact : partial).map(summary);
  if (candidates.length) throw new ToolError("ambiguous", `'${ref}' matches more than one workspace`, candidates);
  throw new ToolError("not_found", `No workspace you can access matches '${ref}'`, workspaces.map(summary));
}

/**
 * The workspace a tool should act on: the `workspace` argument if given, else
 * the token's active workspace, else the only workspace the user can see.
 */
export async function resolveWorkspace(ctx: ToolContext, ref: string | undefined, assumptions: string[]): Promise<WorkspaceRef> {
  const workspaces = await visibleWorkspaces(ctx.db);
  if (ref) return matchWorkspace(workspaces, ref);
  if (ctx.activeWorkspaceId) {
    const active = workspaces.find((w) => w.id === ctx.activeWorkspaceId);
    if (active) return active;
  }
  if (workspaces.length === 1) {
    assumptions.push(`No active workspace set; using the only workspace you can access ('${workspaces[0]!.name}').`);
    return workspaces[0]!;
  }
  if (!workspaces.length) throw new ToolError("not_found", "You don't have access to any workspaces");
  throw new ToolError("no_active_workspace", "Call set_active_workspace first, or pass `workspace`", workspaces.map(summary));
}

export type ProcessWithDraft = ProcessRow & { draft_revision_id: string | null };

/**
 * Find a process by id or name; with no ref, the workspace's only process, or
 * its only pipeline (servicing processes run beside it, and a run of the
 * pipeline includes them; issue #19).
 */
export async function resolveProcess(
  ctx: ToolContext,
  workspace: WorkspaceRef,
  ref: string | undefined,
  assumptions: string[],
): Promise<ProcessWithDraft> {
  const processes = await listProcesses(ctx.db, workspace.id);
  const list = () => processes.map((p) => ({ id: p.id, name: p.name }));
  if (!processes.length) throw new ToolError("not_found", `Workspace '${workspace.name}' has no processes`);
  if (!ref) {
    const pipelines = processes.filter((p) => p.kind !== "servicing");
    if (processes.length > 1 && pipelines.length === 1) {
      assumptions.push(`No process given; using the workspace's only pipeline ('${pipelines[0]!.name}'), whose runs include its servicing processes.`);
      return pipelines[0]!;
    }
    if (processes.length > 1) {
      throw new ToolError("ambiguous", "This workspace has more than one process; pass `process`", list());
    }
    assumptions.push(`No process given; using the workspace's only process ('${processes[0]!.name}').`);
    return processes[0]!;
  }
  const needle = ref.trim().toLowerCase();
  const exact = processes.filter((p) => p.id === needle || p.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;
  const partial = processes.filter((p) => p.name.toLowerCase().includes(needle));
  if (exact.length === 0 && partial.length === 1) return partial[0]!;
  const candidates = (exact.length ? exact : partial).map((p) => ({ id: p.id, name: p.name }));
  if (candidates.length) throw new ToolError("ambiguous", `'${ref}' matches more than one process`, candidates);
  throw new ToolError("not_found", `No process in '${workspace.name}' matches '${ref}'`, list());
}

/** The revision id for `live` or `draft`, or a ToolError if there is none. */
export function revisionIdFor(process: ProcessWithDraft, revision: "live" | "draft"): string {
  const id = revision === "draft" ? process.draft_revision_id : process.live_revision_id;
  if (!id) throw new ToolError("not_found", `Process '${process.name}' has no ${revision} revision`);
  return id;
}
