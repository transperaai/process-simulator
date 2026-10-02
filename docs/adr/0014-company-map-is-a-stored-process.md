# 14. The company map is a stored process; a placed process is held by a link, never edited

Date: 2 Oct 2026 · Status: accepted · Issue: #163 (B11, slice 1 of 2) · Builds on PRD D26 and D39, migration 20261108000000 (nested processes) · Relaxed later by B12 (#164)

## Context

PRD §3 and D26 say "the company map is the root process", but until now it was only a way of drawing: the Overview
computed it on the fly (`apps/web/src/lib/overview/company-map.ts`) with a fake id, computed positions and made-up
lines from every pipeline to every servicing process. Nothing stored it, so it could not be edited, versioned or
restored. Austin (2 Oct): you can make individual processes, but the company map is where it makes sense, because you can
see the whole picture; it needs editing, history and versions.

## Decision

- **One company process per workspace**, marked `processes.is_company` (a boolean, not a new `kind`: it is none of
  pipeline or servicing). A partial unique index allows one per workspace; a check keeps it parent-less; a trigger stops
  anyone signed in creating one, flipping the marker or deleting it (deleting the workspace still removes it).
- **Its live revision holds the map.** One `subprocess` holder step per process on the map, `child_process_id` pointing at
  the placed process, `x` and `y` its position; the edges between holders are **handoff lines** (a label on an edge is the
  line's label). Groups on the map are ordinary groups. All of it is layout: the engine never sees the company process
  (`listProcesses` leaves it out of every list of processes, and `toEngineModel` refuses a bundle of it), so golden
  outputs do not move. Handoffs are **visual only** for now (D39).
- **Top-level linkage: the least invasive option.** A top-level process keeps `parent_process_id = null`. "On the
  company map" means "held by a holder step in the company process's revision". Every existing "top-level = no parent"
  check (`company-map.ts`, `model.ts`, `queries.ts`, the step inspector, the Processes list) stays true. The alternative,
  setting `parent_process_id` to the company process, would have rewritten all of them.
- **Placing a process on a map is a link held only by the map.** The placed process row is never written: no parent, no
  flag, no `updated_at` change. The link lives in the target's revision (its draft, then live once published), so edits to
  the placed process show through the link, and taking it off the map (deleting the holder) leaves it untouched. A
  trigger on `processes` keeps the map's *own* rows in step (a new top-level process gets a holder at the bottom of its
  column and a handoff line to each holder of the other kind; a deleted or nested one loses its holder; a rename renames
  the holder). It writes only the company map's steps and edges.
- **The holder rule is one function: `private.holder_allows(owner, child)`.** `check_step_nesting` calls it. Today it
  allows (a) a child process held by its parent, and (b) a parent-less, non-company process held by a company process. A
  process is therefore held **once** in the whole tree: a process with a parent is refused on the company map, and a
  parent-less one is refused inside an ordinary process (no double counting). **B12 (#164) generalises this** (any process
  may hold others, with a map being just a process whose holders are placed by link): change `holder_allows`, and add the
  "at most once in the published tree" check where it is relaxed. Nothing else needs to move.
- **Backfill and seeds.** The migration gives every existing workspace a company process with a published revision 1
  whose holders reproduce today's computed layout (`packages/db/src/company-map.ts`, `defaultCompanyPart`, is the same
  algorithm in TypeScript; a test checks the SQL and TypeScript agree on Northbeam and Larkspur) and today's
  pipeline-to-servicing lines. A trigger on `workspaces` gives new workspaces one. The seed lays the map out after every
  process is published (`private.relayout_company_map`); the demo (no database) builds it with `defaultCompanyPart`.
- **The Processes list excludes it**, and the Overview is its home: the sidebar and the Processes page already link "Company
  map" to the Overview, which draws it. Slice 2 adds "Edit company map" there (the editor on the company process with
  drafts, publish, history and handoff lines).

## Consequences

- The Overview reads stored positions and lines; opening a card pushes its neighbours aside at draw time (positions on
  the map are for closed cards, as before).
- Anything that lists processes must go through `listProcesses` (which excludes the company map unless asked) or
  filter `is_company`. MCP `get_workspace_summary` and `get_process` show the map; every other tool refuses it.
- Until slice 2, the company process is **locked against signed-in people**: guards on `processes` and
  `process_revisions` refuse renames, kind, parent and revision-pointer changes, any process taking it as parent, and any
  creation, change or deletion of its revisions (so `open_draft`, `publish_process`, `restore_version` stop on it);
  `duplicate_version` refuses it. Slice 2 lifts these guards for editors (`private.company_signed_in`).
- **Slice 2 blockers (known, not fixed in slice 1):**
  1. `sync_company_map` deletes `subprocess` steps whose `child_process_id` is null and re-adds a holder for any
     top-level process the revision lacks, including in an open draft: a holder someone deliberately removed from a draft
     would come back, and an empty holder step they added would be deleted. Slice 2 must decide what "off the map" means
     (a removed holder is a choice) before the editor exists.
  2. `restore_version` keeps a holder's `child_process_id` only when the child's parent is the owner process, so
     restoring a company-map version would unlink every holder (the company map has no children by parent), and
     `duplicate_version` would copy holders with no children. Both need the same awareness as `holder_allows`.
  3. The sync triggers (`sync_company_map`, the rename and kind updates) edit the live (published) revision, and a
     draft, in place as `SECURITY DEFINER`, bypassing `edit_drafts_only`. That is fine for a layout that follows the
     processes, but versions in the history are then not immutable. Slice 2 must route sync into the draft (and publish
     it as a new version) instead.
- Slice 2 needs: an editor route for the company process, a loader that includes it (`listProcesses(..., { includeCompany: true })`),
  and a decision on whether placing a process on a map in a draft should also create the holder in a later published
  version (the sync trigger already adds holders to an open draft).
