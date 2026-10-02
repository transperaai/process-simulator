-- Editing the company map (issue #163, B11 slice 2 of 2; PRD D26 and D39; ADR 0014).
--
-- Slice 1 (20261126000000) made the company map a stored process and locked it against signed-in people. This
-- migration lets editors work on it like any process (a draft, the diff against live, publish, version history,
-- restore) and clears the three blockers ADR 0014 recorded. What stays refused: renaming it, changing its kind or
-- parent, deleting it, making it a process's parent, and `duplicate_version` (a copy of a map is not a process).
--
-- NO TABLE OR COLUMN CHANGES: functions and one trigger only. Additive in effect: the only things dropped are
-- `private.sync_company_map`, which this replaces, and `public.revision_history`, which is dropped and re-created with
-- one more column.
--
--   * `private.company_process_guard` (full copy of 20261126000000's, changed): an editor may now move the draft and
--     live pointers (open_draft, publish_process, discard_draft and restore_version do), but the live pointer may not
--     go null and neither may point at a revision of another process; renaming, kind, parent and deleting stay
--     refused, as does taking the company map as a process's parent;
--   * `private.company_revision_guard` (full copy, changed): a signed-in person may create, change and delete the company
--     map's revisions only if they may edit the workspace (`can_edit_workspace`, as restore_version checks);
--   * `private.company_holder_guard` and trigger `company_holder_guard` on `public.steps` (new): nobody signed in deletes a
--     holder step of the company map ("Removing processes from the map comes with the process library", B12 #164).
--     It does not fire for the system, for restore_version (security definer) or for the cascades of discarding a
--     draft, deleting a process or deleting a workspace;
--   * `public.restore_version` (full copy of 20261118000000's, changed): on the company map a holder keeps its
--     `child_process_id` while `private.holder_allows(owner, child)` still says the process may sit on it; one whose
--     process is gone or now sits inside another is skipped (with its lines) and counted in `skipped_holders`;
--     top-level processes the restored version did not hold (made since) are added at the bottom of their column and
--     counted in `added_holders`; holders take the process's current name. Ordinary processes behave as before (the same
--     rule, now written through `holder_allows`);
--   * `public.revision_history` (dropped and re-created: a full copy of 20261118000000's with one more column, `note`):
--     the note a system-made version carries ("Added Sales"), from its audit entry;
--   * the SYNC RULE (ADR 0014, blocker fixes). The map follows the workspace's top-level processes, but it never edits a
--     published version in place and never decides for the user. A change to the set or names of top-level processes is an
--     EVENT: a process created, deleted, nested under another, taken out of one, renamed, or changed from pipeline
--     to servicing. Each event is applied to the company map as
--       1. a new published version made by the system (`private.company_new_version`: a copy of the live version with
--          the same step and edge ids, the old live one superseded, published_by null, an audit entry `publish` by
--          `system` whose diff carries `note`, e.g. "Added Sales"), so the history says what happened and old versions
--          are never touched; skipped when live already says it (nothing to change); and
--       2. the same change in the open draft, if there is one (`private.company_map_edit`), so the draft keeps agreeing with
--          live where the user has not changed it: a holder is added only if the draft has none for that process; a rename
--          or a move only touches a holder the user has not renamed or moved.
--     Sync never deletes a step except the holder of the process the event is about, never adds a holder except for the
--     process the event is about, and never reconciles "what is missing": subprocess or group steps a person drew are
--     left alone, and a holder a person took out of a draft is not put back by an unrelated event. A kind change moves the
--     holder to the bottom of the other column and keeps every line (handoff lines belong to the people who draw them);
--   * `private.company_map_membership`, `private.company_map_before_delete` (replaced) call it; `private.sync_company_map`
--     (the old in-place reconciler) is dropped; `private.relayout_company_map` (seed and backfill only, the app never calls
--     it) is replaced: it now starts the map over as a single version 1;
--   * `private.company_new_version`, `private.company_add_holder`, `private.company_map_edit`, `private.company_map_apply`
--     (new, private, executable by nobody signed in).
--
-- Preflight (production):
--   1. Nothing of ours is applied past 20261127500000. Expect 0 rows:
--        select version from supabase_migrations.schema_migrations where version >= '20261127500000';
--   2. 20261126000000 (company_map) is applied. Expect 1 row:
--        select version from supabase_migrations.schema_migrations where version = '20261126000000';
--   3. The functions this one replaces are as reviewed. Expect one row, true, for each of the four queries:
--        select prosrc like '%editing it arrives with its editor%' from pg_proc where pronamespace = 'private'::regnamespace and proname = 'company_process_guard';
--        select prosrc like '%can''t be versioned yet%' from pg_proc where pronamespace = 'private'::regnamespace and proname = 'company_revision_guard';
--        select prosrc like '%c.parent_process_id = proc.id%' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'restore_version';
--        select pg_get_function_result(oid) not like '%note%' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'revision_history';
--   4. The old reconciler is there to be dropped. Expect one row, true:
--        select count(*) = 1 from pg_proc where pronamespace = 'private'::regnamespace and proname = 'sync_company_map';
--   5. No company map has an open draft or more than its first version (nothing has edited one yet). Expect 0 rows:
--        select c.id from public.processes c where c.is_company and (c.draft_revision_id is not null or (select count(*) from public.process_revisions r where r.process_id = c.id) > 1);
--   6. How many company maps this touches (note it): select count(*) from public.processes where is_company;
--
-- Post-apply checks:
--   1. The new private functions are executable by nobody signed in or anonymous. Expect 0 rows:
--        select routine_name from information_schema.routine_privileges where routine_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC')
--          and routine_name in ('company_new_version', 'company_add_holder', 'company_map_edit', 'company_map_apply', 'company_holder_guard', 'company_process_guard', 'company_revision_guard', 'company_map_membership', 'company_map_before_delete', 'relayout_company_map');
--   2. The old reconciler is gone and the holder guard is on steps. Expect 0, then 1:
--        select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname = 'sync_company_map';
--        select count(*) from pg_trigger where tgrelid = 'public.steps'::regclass and tgname = 'company_holder_guard' and not tgisinternal;
--   3. revision_history returns the note, authenticated may call it and restore_version, anon may not. Expect true, true, false:
--        select pg_get_function_result('public.revision_history(uuid)'::regprocedure) like '%note text%';
--        select has_function_privilege('authenticated', 'public.revision_history(uuid)', 'execute') and has_function_privilege('authenticated', 'public.restore_version(uuid, uuid, boolean)', 'execute');
--        select has_function_privilege('anon', 'public.revision_history(uuid)', 'execute') or has_function_privilege('anon', 'public.restore_version(uuid, uuid, boolean)', 'execute');
--   4. Nothing was versioned by applying it: every company map still has exactly one revision. Expect 0 rows:
--        select c.id from public.processes c where c.is_company and (select count(*) from public.process_revisions r where r.process_id = c.id) <> 1;
--
-- Rollback (newest first; run in one transaction). FIRST redeploy the app to a build from before this migration (it
-- calls restore_version for the company map and reads revision_history's note). Company-map versions, drafts and
-- handoff labels made meanwhile stay as rows (they are ordinary revisions, steps and edges), but slice 1's guards
-- come back and refuse any further change to them:
--
--   begin;
--   drop trigger company_holder_guard on public.steps;
--   drop function private.company_holder_guard();
--   drop function private.company_map_apply(uuid, uuid, text, text, text, text);
--   drop function private.company_map_edit(uuid, uuid, text, boolean, text, text);
--   drop function private.company_add_holder(uuid, uuid);
--   drop function private.company_new_version(uuid);
--   drop function public.revision_history(uuid);
--   -- Re-create, from packages/db/supabase/migrations/20261118000000_process_history.sql: the `create function public.revision_history`
--   -- block and the two lines that revoke and grant it, then `public.restore_version` (as `create or replace function`).
--   -- Re-create, from packages/db/supabase/migrations/20261126000000_company_map.sql, as `create or replace function`:
--   -- private.company_process_guard, private.company_revision_guard, private.company_map_before_delete,
--   -- private.company_map_membership, private.relayout_company_map; and `create function private.sync_company_map` with its
--   -- `revoke all ... from public, anon, authenticated`.
--   delete from supabase_migrations.schema_migrations where version = '20261127500000';
--   commit;

-- ---------------------------------------------------------------------------
-- Who may change the company map, now that it has an editor
-- ---------------------------------------------------------------------------

-- A full copy of 20261126000000's, changed: a signed-in person (RLS lets only editors update a process) may move the
-- draft and live pointers, which open_draft, publish_process, discard_draft and restore_version do; the live pointer may
-- not go null, and the pointers may only name this process's own versions. Name, kind, parent and deletion stay refused,
-- as does making the map a parent.
create or replace function private.company_process_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' and new.parent_process_id is not null
     and exists (select 1 from public.processes p where p.id = new.parent_process_id and p.is_company) then
    raise exception 'The company map holds processes by link: it can''t be a process''s parent' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_company and private.company_signed_in() then
      raise exception 'The company map is made by the system, not inserted' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.is_company is distinct from old.is_company then
      raise exception 'A process cannot become, or stop being, the company map' using errcode = '23514';
    end if;
    if old.is_company and private.company_signed_in() then
      if (new.name, new.kind, new.parent_process_id) is distinct from (old.name, old.kind, old.parent_process_id) then
        raise exception 'The company map can''t be renamed, changed to another kind or put inside another process' using errcode = '55000';
      end if;
      if new.live_revision_id is null and old.live_revision_id is not null then
        raise exception 'The company map must keep a live version' using errcode = '55000';
      end if;
      if (new.live_revision_id is distinct from old.live_revision_id or new.draft_revision_id is distinct from old.draft_revision_id)
         and exists (
           select 1 from (values (new.live_revision_id), (new.draft_revision_id)) v (rid)
           where v.rid is not null and not exists (select 1 from public.process_revisions r where r.id = v.rid and r.process_id = new.id)
         ) then
        raise exception 'The company map can only point at its own versions' using errcode = '55000';
      end if;
    end if;
    return new;
  end if;
  if old.is_company and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    raise exception 'The company map can''t be deleted' using errcode = '23514';
  end if;
  return old;
end;
$$;

-- A full copy of 20261126000000's, changed: editors may now write the company map's revisions (open a draft, publish,
-- discard, restore); anyone else signed in still may not. The workspace being deleted lets everything go.
create or replace function private.company_revision_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.process_revisions := case when tg_op = 'DELETE' then old else new end;
begin
  if private.company_signed_in()
     and exists (select 1 from public.processes p where p.id = r.process_id and p.is_company)
     and exists (select 1 from public.workspaces w where w.id = r.workspace_id)
     and public.can_edit_workspace(r.workspace_id) is not true then
    raise exception 'The company map can''t be versioned by someone who can''t edit this workspace' using errcode = '55000';
  end if;
  return r;
end;
$$;

-- Taking a process off the map is a choice the library makes (B12, #164): until then a holder of the company map can be
-- moved and joined by handoff lines but not deleted by a signed-in person. The system, restore_version (security definer)
-- and cascades (discarding a draft, deleting a process or a workspace) run as the table owner and are not refused.
create function private.company_holder_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and private.company_signed_in()
     and exists (select 1 from public.process_revisions r join public.processes p on p.id = r.process_id where r.id = old.revision_id and p.is_company)
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    raise exception 'Removing processes from the map comes with the process library' using errcode = '55000';
  end if;
  return old;
end;
$$;

revoke all on function private.company_holder_guard() from public, anon, authenticated;

create trigger company_holder_guard before delete on public.steps
  for each row when (old.child_process_id is not null) execute function private.company_holder_guard();

-- ---------------------------------------------------------------------------
-- The sync rule: events, not reconciliation
-- ---------------------------------------------------------------------------

-- A new published version of the company map, made by the system: a copy of the live version (the same step and edge
-- ids, so a diff against the version before shows only what changed), numbered one above every version there is. The old
-- live version becomes superseded and is not touched otherwise. Returns the new revision's id.
create function private.company_new_version(p_cid uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  old public.process_revisions;
  rid uuid := gen_random_uuid();
  n integer;
begin
  select r.* into old from public.process_revisions r join public.processes c on c.live_revision_id = r.id where c.id = p_cid;
  select coalesce(max(r.number), 0) + 1 into n from public.process_revisions r where r.process_id = p_cid;
  -- Superseded first (one published revision per process), then the copy, then the process points at it.
  update public.process_revisions r set status = 'superseded' where r.id = old.id;
  insert into public.process_revisions (id, workspace_id, process_id, number, status, layout, published_at, published_by, created_by)
  values (rid, old.workspace_id, p_cid, n, 'published', old.layout, now(), null, null);
  insert into public.steps
  select (jsonb_populate_record(null::public.steps,
    to_jsonb(s) || jsonb_build_object('revision_id', rid, 'created_at', now(), 'updated_at', now()))).*
  from public.steps s where s.revision_id = old.id;
  insert into public.edges
  select (jsonb_populate_record(null::public.edges,
    to_jsonb(e) || jsonb_build_object('revision_id', rid, 'created_at', now(), 'updated_at', now()))).*
  from public.edges e where e.revision_id = old.id;
  update public.processes p set live_revision_id = rid where p.id = p_cid;
  return rid;
end;
$$;

-- A holder for `p_proc` in revision `p_rev` of a company map, at the bottom of its column (pipelines in column 0,
-- servicing processes in column 1, as the Overview has always laid them out) with a handoff line to each holder of the
-- other kind. Does nothing, and returns false, when the process may not be held (it has a parent, or is a company map) or
-- the revision already holds it.
create function private.company_add_holder(p_rev uuid, p_proc uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  proc public.processes;
  cid uuid;
  ws uuid;
  nx numeric;
  ny numeric;
  hid uuid := gen_random_uuid();
begin
  select * into proc from public.processes p where p.id = p_proc;
  select r.process_id, r.workspace_id into cid, ws from public.process_revisions r where r.id = p_rev;
  if proc.id is null or proc.is_company or proc.parent_process_id is not null or proc.workspace_id is distinct from ws then
    return false;
  end if;
  if exists (select 1 from public.steps s where s.revision_id = p_rev and s.child_process_id = p_proc) then
    return false;
  end if;
  nx := case when proc.kind = 'servicing' then 288 else 0 end;
  -- Below whatever already sits in that column (a card is 192 wide): people move cards, so this is by position.
  select coalesce(max(s.y) + 160, 0) into ny from public.steps s
  where s.revision_id = p_rev and s.parent_step_id is null and s.x > nx - 192 and s.x < nx + 192;
  insert into public.steps (id, revision_id, workspace_id, process_id, name, kind, child_process_id, x, y)
  values (hid, p_rev, ws, cid, proc.name, 'subprocess', proc.id, nx, ny);
  insert into public.edges (revision_id, workspace_id, process_id, from_step_id, to_step_id, probability)
  select p_rev, ws, cid,
    case when proc.kind = 'servicing' then s.id else hid end,
    case when proc.kind = 'servicing' then hid else s.id end, 1
  from public.steps s join public.processes q on q.id = s.child_process_id
  where s.revision_id = p_rev and s.id <> hid and (q.kind = 'servicing') <> (proc.kind = 'servicing');
  return true;
end;
$$;

-- One change to a revision of the company map, in place (the revision is a new system-made version or a draft, never one
-- already published): 'add' a holder, 'remove' the holder, 'rename' it to the process's name, 'move' it to the other
-- column. In a draft (`p_live` false) a rename or a move leaves alone a holder the person has renamed or moved.
create function private.company_map_edit(p_rev uuid, p_proc uuid, p_change text, p_live boolean, p_old_name text, p_old_kind text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  proc public.processes;
  nx numeric;
  ny numeric;
  old_x numeric;
begin
  select * into proc from public.processes p where p.id = p_proc;
  if p_change = 'add' then
    perform private.company_add_holder(p_rev, p_proc);
  elsif p_change = 'remove' then
    delete from public.steps s where s.revision_id = p_rev and s.child_process_id = p_proc;
  elsif p_change = 'rename' then
    update public.steps s set name = proc.name
    where s.revision_id = p_rev and s.child_process_id = p_proc and (p_live or s.name = p_old_name);
  elsif p_change = 'move' then
    nx := case when proc.kind = 'servicing' then 288 else 0 end;
    old_x := case when p_old_kind = 'servicing' then 288 else 0 end;
    select coalesce(max(s.y) + 160, 0) into ny from public.steps s
    where s.revision_id = p_rev and s.parent_step_id is null and s.child_process_id is distinct from p_proc and s.x > nx - 192 and s.x < nx + 192;
    update public.steps s set x = nx, y = ny
    where s.revision_id = p_rev and s.child_process_id = p_proc and (p_live or s.x = old_x);
  end if;
end;
$$;

-- Applies one event to the workspace's company map: a new system-made version of live (when live does not already say
-- it), and the same change in an open draft. `p_note` is what the history says ("Added Sales").
create function private.company_map_apply(p_ws uuid, p_proc uuid, p_change text, p_note text, p_old_name text default null, p_old_kind text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cid uuid;
  live_id uuid;
  draft_id uuid;
  proc public.processes;
  needed boolean;
  new_id uuid;
  new_number integer;
  old_number integer;
begin
  -- The workspace being deleted takes the map with it: nothing to keep in step.
  if not exists (select 1 from public.workspaces w where w.id = p_ws) then
    return;
  end if;
  cid := private.ensure_company_map(p_ws);
  if cid is null then
    return;
  end if;
  -- One event at a time per workspace: two processes made together each get their own place, lines and version.
  perform 1 from public.processes c where c.id = cid for update;
  select * into proc from public.processes p where p.id = p_proc;
  select c.live_revision_id, c.draft_revision_id into live_id, draft_id from public.processes c where c.id = cid;
  -- The guards let the system through, whoever's statement this runs inside.
  perform set_config('transpera.company_system', 'on', true);
  if live_id is not null then
    needed := case p_change
      when 'add' then proc.id is not null and not proc.is_company and proc.parent_process_id is null
        and not exists (select 1 from public.steps s where s.revision_id = live_id and s.child_process_id = p_proc)
      when 'remove' then exists (select 1 from public.steps s where s.revision_id = live_id and s.child_process_id = p_proc)
      when 'rename' then exists (select 1 from public.steps s where s.revision_id = live_id and s.child_process_id = p_proc and s.name is distinct from proc.name)
      when 'move' then exists (select 1 from public.steps s where s.revision_id = live_id and s.child_process_id = p_proc
        and s.x is distinct from (case when proc.kind = 'servicing' then 288 else 0 end))
      else false end;
    if needed then
      new_id := private.company_new_version(cid);
      perform private.company_map_edit(new_id, p_proc, p_change, true, p_old_name, p_old_kind);
      select r.number into new_number from public.process_revisions r where r.id = new_id;
      select r.number into old_number from public.process_revisions r where r.id = live_id;
      -- The same entry a person's publish leaves (history reads it), by the system, with the note.
      insert into public.audit_log (workspace_id, actor_id, actor_kind, action, target_table, target_id, diff)
      values (p_ws, null, 'system', 'publish', 'processes', cid, jsonb_build_object(
        'revision_id', new_id, 'number', new_number, 'previous_revision_id', live_id, 'previous_number', old_number,
        'accept_estimates', false, 'estimates', '[]'::jsonb, 'note', p_note,
        'changes', private.revision_changes(live_id, new_id)));
    end if;
  end if;
  if draft_id is not null then
    perform private.company_map_edit(draft_id, p_proc, p_change, false, p_old_name, p_old_kind);
  end if;
  perform set_config('transpera.company_system', '', true);
end;
$$;

-- Replaced: the events call company_map_apply (a full copy of 20261126000000's trigger functions, changed).
create or replace function private.company_map_before_delete() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not old.is_company then
    perform private.company_map_apply(old.workspace_id, old.id, 'remove', 'Removed ' || old.name);
  end if;
  return old;
end;
$$;

create or replace function private.company_map_membership() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.is_company then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.parent_process_id is null then
      perform private.company_map_apply(new.workspace_id, new.id, 'add', 'Added ' || new.name);
    end if;
    return null;
  end if;
  if new.parent_process_id is distinct from old.parent_process_id then
    if new.parent_process_id is null then
      perform private.company_map_apply(new.workspace_id, new.id, 'add', 'Added ' || new.name);
    elsif old.parent_process_id is null then
      perform private.company_map_apply(new.workspace_id, new.id, 'remove', 'Removed ' || new.name || ' from the map: it now sits inside another process');
    end if;
  end if;
  if new.kind is distinct from old.kind and new.parent_process_id is null then
    perform private.company_map_apply(new.workspace_id, new.id, 'move',
      new.name || ' is now ' || case when new.kind = 'servicing' then 'a servicing process' else 'a sales pipeline' end, null, old.kind);
  end if;
  if new.name is distinct from old.name then
    perform private.company_map_apply(new.workspace_id, new.id, 'rename', 'Renamed ' || old.name || ' to ' || new.name, old.name);
  end if;
  return null;
end;
$$;

-- Replaced: starts the map over as one version, as the Overview would lay it out today. For the seed and the backfill
-- only, before anyone has a history; the app never calls it (it would undo people's moves and erase their versions).
create or replace function private.relayout_company_map(p_ws uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cid uuid;
  rid uuid;
begin
  cid := private.ensure_company_map(p_ws);
  if cid is null then
    return;
  end if;
  perform set_config('transpera.company_system', 'on', true);
  select p.live_revision_id into rid from public.processes p where p.id = cid;
  update public.processes p set draft_revision_id = null where p.id = cid;
  delete from public.process_revisions r where r.process_id = cid and r.id <> rid;
  update public.process_revisions r set number = 1 where r.id = rid;
  delete from public.steps s where s.revision_id = rid;
  perform private.company_layout_insert(p_ws, rid);
  -- The versions it dropped leave no trace in the log either.
  delete from public.audit_log l where l.workspace_id = p_ws and l.target_table = 'processes' and l.target_id = cid;
  perform set_config('transpera.company_system', '', true);
end;
$$;

drop function private.sync_company_map(uuid);

revoke all on function private.company_new_version(uuid) from public, anon, authenticated;
revoke all on function private.company_add_holder(uuid, uuid) from public, anon, authenticated;
revoke all on function private.company_map_edit(uuid, uuid, text, boolean, text, text) from public, anon, authenticated;
revoke all on function private.company_map_apply(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- restore_version: a company map keeps its holders' links
-- ---------------------------------------------------------------------------

-- A full copy of 20261118000000's, changed (marked "company map"): the rule for a holder step keeping its child process is
-- `private.holder_allows(owner, child)`, the one place that says who may hold whom (so a process that was nested since is
-- not re-linked, one that is gone is not either), and on the company map a holder that can't be re-linked is skipped with
-- its lines instead of left as an empty card. Top-level processes the version did not hold are added back at the bottom of
-- their column, so a restore never drops a process off the map by accident.
create or replace function public.restore_version(target_process uuid, source_revision uuid, replace_draft boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proc public.processes;
  src public.process_revisions;
  draft public.process_revisions;
  unlinked integer;
  untouched constant jsonb := '{"steps":{"added":[],"removed":[],"changed":[]},"edges":{"added":[],"removed":[],"changed":[]}}';
  had_draft boolean;
  kind text := case
    when auth.jwt() ? 'api_token_id' then 'mcp'
    when auth.uid() is not null then 'user'
    else 'system' end;
  entry jsonb;
  ws uuid;
  -- company map: holders that can't be re-linked, and processes added back
  skipped uuid[] := '{}';
  added integer := 0;
  np record;
begin
  -- Security definer: the caller's right to edit is checked here, before the process row is locked, and only the
  -- process's draft is written.
  select p.workspace_id into ws from public.processes p where p.id = target_process;
  if ws is null or public.can_edit_workspace(ws) is not true then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into proc from public.processes p where p.id = target_process for update;
  if proc.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into src from public.process_revisions r where r.id = source_revision and r.process_id = proc.id;
  if src.id is null or src.status = 'draft' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if src.id = proc.live_revision_id then
    return jsonb_build_object('status', 'already_live');
  end if;

  select * into draft from public.process_revisions r where r.process_id = proc.id and r.status = 'draft';
  had_draft := draft.id is not null;
  if draft.id is not null then
    -- A draft nobody has changed (just opened) is safe to replace; one with work in it needs a yes.
    if not coalesce(replace_draft, false)
       and (proc.live_revision_id is null
            and exists (select 1 from public.steps s where s.revision_id = draft.id)
            or proc.live_revision_id is not null and private.revision_changes(proc.live_revision_id, draft.id) <> untouched) then
      return jsonb_build_object('status', 'draft_exists', 'number', draft.number);
    end if;
    -- Edges go with their steps.
    delete from public.steps s where s.revision_id = draft.id;
    update public.process_revisions r set layout = src.layout where r.id = draft.id;
  else
    insert into public.process_revisions (workspace_id, process_id, number, status, layout)
    values (
      proc.workspace_id,
      proc.id,
      coalesce((select max(r.number) from public.process_revisions r where r.process_id = proc.id), 0) + 1,
      'draft',
      src.layout)
    returning * into draft;
  end if;

  -- A holder step keeps its child process only while that process may still sit inside this one.
  select count(*) into unlinked from public.steps s
  where s.revision_id = src.id and s.child_process_id is not null
    and not exists (select 1 from public.processes c where c.id = s.child_process_id and private.holder_allows(proc.id, c));
  -- company map: a holder with no process to link (gone, or nested since) is not restored, with the lines on it.
  if proc.is_company then
    select coalesce(array_agg(s.id), '{}') into skipped from public.steps s
    where s.revision_id = src.id and s.kind = 'subprocess'
      and not exists (select 1 from public.processes c where c.id = s.child_process_id and private.holder_allows(proc.id, c));
    unlinked := 0;
  end if;

  insert into public.steps
  select (jsonb_populate_record(null::public.steps,
    to_jsonb(s) || jsonb_build_object(
      'revision_id', draft.id,
      'created_at', now(),
      'updated_at', now(),
      'child_process_id', (select c.id from public.processes c where c.id = s.child_process_id and private.holder_allows(proc.id, c)),
      -- company map: a holder is called what its process is called now
      'name', coalesce((select c.name from public.processes c where proc.is_company and c.id = s.child_process_id and private.holder_allows(proc.id, c)), s.name),
      'entry_step_id', case when s.entry_step_id = any (skipped) then null else s.entry_step_id end,
      'rework_to_step_id', case when s.rework_to_step_id = any (skipped) then null else s.rework_to_step_id end))).*
  from public.steps s where s.revision_id = src.id and not (s.id = any (skipped));
  insert into public.edges
  select (jsonb_populate_record(null::public.edges,
    to_jsonb(e) || jsonb_build_object('revision_id', draft.id, 'created_at', now(), 'updated_at', now()))).*
  from public.edges e where e.revision_id = src.id and not (e.from_step_id = any (skipped) or e.to_step_id = any (skipped));

  -- company map: processes made since that version stay on the map.
  if proc.is_company then
    for np in
      select p.id from public.processes p
      where p.workspace_id = proc.workspace_id and not p.is_company and p.parent_process_id is null
        and not exists (select 1 from public.steps s where s.revision_id = draft.id and s.child_process_id = p.id)
      order by p.created_at, p.id
    loop
      if private.company_add_holder(draft.id, np.id) then
        added := added + 1;
      end if;
    end loop;
  end if;

  update public.processes p set draft_revision_id = draft.id where p.id = proc.id;

  -- One audit entry says what happened. A new draft already has an 'open_draft' entry (written by the trigger on the
  -- insert, in this transaction, saying it came from live); it is rewritten rather than followed by a second.
  entry := jsonb_build_object('revision_id', draft.id, 'number', draft.number, 'restored_from_revision_id', src.id,
    'restored_from_number', src.number, 'replaced_draft', had_draft);
  if proc.is_company then
    entry := entry || jsonb_build_object('skipped_holders', cardinality(skipped), 'added_holders', added);
  end if;
  if not had_draft then
    update public.audit_log l set action = 'restore_version', diff = entry
    -- Narrowed to this workspace and this transaction's timestamp so it uses the (workspace_id, created_at) index.
    where l.workspace_id = proc.workspace_id and l.target_table = 'processes' and l.created_at = now()
      and l.target_id = proc.id and l.action = 'open_draft' and l.diff ->> 'revision_id' = draft.id::text;
  end if;
  if had_draft or not found then
    insert into public.audit_log (workspace_id, actor_id, actor_kind, action, target_table, target_id, diff)
    values (proc.workspace_id, auth.uid(), kind, 'restore_version', 'processes', proc.id, entry);
  end if;
  return jsonb_build_object('status', 'restored', 'revision_id', draft.id, 'number', draft.number, 'unlinked_children', unlinked,
    'skipped_holders', cardinality(skipped), 'added_holders', added);
end;
$$;

revoke execute on function public.restore_version(uuid, uuid, boolean) from public, anon;
grant execute on function public.restore_version(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- revision_history: a system-made version says what it did
-- ---------------------------------------------------------------------------

-- A full copy of 20261118000000's with one more column, `note`: what the version's audit entry says it did ("Added Sales"),
-- which only a system-made version of the company map has. Dropped first: a function's result columns can't be changed.
drop function public.revision_history(uuid);

create function public.revision_history(target_process uuid)
returns table (
  revision_id uuid,
  number integer,
  status text,
  published_at timestamptz,
  author_kind text,
  author_name text,
  changes jsonb,
  note text
)
language sql stable security definer
set search_path = ''
as $$
  select
    r.id,
    r.number,
    r.status,
    r.published_at,
    a.actor_kind,
    coalesce(per.name, case when public.can_manage_workspace(r.workspace_id) then u.email end),
    -- Against the published version before it; none for the first.
    case when prev.id is not null then private.revision_change_counts(prev.id, r.id) end,
    a.note
  from public.processes p
  join public.process_revisions r on r.process_id = p.id
  left join auth.users u on u.id = r.published_by
  left join public.memberships m on m.user_id = r.published_by and m.workspace_id = r.workspace_id
  left join public.people per on per.id = m.person_id and per.workspace_id = r.workspace_id
  left join lateral (
    select l.actor_kind, l.diff ->> 'note' as note
    from public.audit_log l
    where l.workspace_id = r.workspace_id
      and l.target_table = 'processes' and l.target_id = p.id and l.action = 'publish' and l.diff ->> 'revision_id' = r.id::text
    order by l.created_at desc
    limit 1
  ) a on true
  left join lateral (
    select q.id from public.process_revisions q
    where q.process_id = p.id and q.status in ('published', 'superseded') and q.number < r.number
    order by q.number desc
    limit 1
  ) prev on true
  where p.id = target_process
    and public.can_read_workspace(p.workspace_id)
    and r.status in ('published', 'superseded')
  order by r.number desc;
$$;

revoke execute on function public.revision_history(uuid) from public, anon;
grant execute on function public.revision_history(uuid) to authenticated;
