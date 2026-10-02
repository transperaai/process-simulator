-- Production apply file for 20261125500000_build_proposal (A52 slice 2, issue #117). Run after 20261124000000 (suggestions_v2) and A49's 20261122000000.
--
-- Preflight (run first; each should be as described):
--
--   -- 1. The function does not exist yet: expect 0.
--   select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'build_proposal';
--
--   -- 2. Nothing applied past this one: expect no rows.
--   select version from supabase_migrations.schema_migrations where version >= '20261125500000';
--
--   -- 3. save_solution and the proposals table exist: expect 2 rows.
--   select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_solution' union all select table_name from information_schema.tables where table_schema = 'public' and table_name = 'suggestion_proposals';
--
-- Post-apply check (authenticated EXECUTE only; no anon or public row):
--   select grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'build_proposal' and grantee in ('anon', 'authenticated', 'public') order by 1;
--   Also: the schema_migrations row exists.

begin;
set local lock_timeout = '5s';

-- Build a solution idea (issue #117, ticket A52, slice 2 of 2; PRD §7.1c).
--
-- "Build it" on a solution idea opens the Editor in solution mode with the idea's steps placed. Saving turns it into a real
-- solution through `public.save_solution` (A49), and the idea is marked `built`, in the same transaction, so an idea is never
-- built twice and a solution is never saved without the idea knowing. This adds the one function that does both:
--
--   * `public.build_proposal(p_proposal, p_workspace, p_process, p_base_revision, p_name, p_steps, p_changed, p_levers,
--     p_links)`: security invoker, so row-level security applies to everything it writes. It locks the proposal (it must be a
--     pending solution idea of that workspace), calls `save_solution` with the rest, then sets the proposal to `built` with
--     `applied = {solution_id}` and who and when. The decision columns change only here and in `review_proposals`: the guard
--     trigger (`private.suggestion_proposals_before_write`) is unchanged. An API-token request (the MCP server) can't build: a
--     person decides, as with `review_proposals`.
--
-- The solution's origin is recorded on the idea (`applied.solution_id`), not on `solutions`, so the solutions table is not
-- touched. A solution made from an AI idea is one whose id is in `suggestion_proposals.applied ->> 'solution_id'` with status
-- `built`: A50's "Type: AI block" label can read it from there.
--
-- STRICTLY ADDITIVE: one function. No table, column, constraint, trigger or existing function is changed. Needs 20261122000000
-- (`save_solution`) and 20261124000000 (`suggestion_proposals`).
--
-- Preflight (run with `bash packages/db/scripts/prod-sql.sh -c "..."`; each should be as described):
--
--   1. The function does not exist yet. Expect 0:
--        select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'build_proposal';
--   2. Nothing of ours is applied past this one. Expect 0 rows:
--        select version from supabase_migrations.schema_migrations where version >= '20261125500000';
--   3. save_solution and the proposals table exist. Expect 2 rows:
--        select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_solution'
--        union all select table_name from information_schema.tables where table_schema = 'public' and table_name = 'suggestion_proposals';
--
-- Post-apply grant check (authenticated may execute it, anon may not):
--        select grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'build_proposal' and grantee in ('anon', 'authenticated', 'public') order by 1;
--   Expect: one row, authenticated EXECUTE.
--
-- Rollback (run as one transaction; nothing existing was changed):
--
--   begin;
--   drop function if exists public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb);
--   delete from supabase_migrations.schema_migrations where version = '20261125500000';
--   commit;
--
-- Ideas already built stay `built` and keep their `applied.solution_id`; solutions they made stay.
--
-- Production data: none needed.

create function public.build_proposal(
  p_proposal uuid, p_workspace uuid, p_process uuid, p_base_revision uuid, p_name text, p_steps jsonb, p_changed jsonb,
  p_levers jsonb, p_links jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.suggestion_proposals;
  result jsonb;
begin
  if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
    raise exception 'Ideas are built by a person in the app, not over the API' using errcode = '42501';
  end if;
  -- Every column but the visitor's email, which this role can't read (position matters: it is the table's order).
  select x.id, x.workspace_id, x.kind, x.title, x.detail, x.payload, x.evidence, x.note, x.issue_id, x.status, x.created_via,
    x.proposer_name, null::text, x.applied, x.review_note, x.reviewed_by, x.reviewed_at, x.created_at, x.updated_at, x.created_by
    into p from public.suggestion_proposals x where x.id = p_proposal and x.workspace_id = p_workspace for update;
  if p.id is null then
    raise exception 'build_proposal: no such idea' using errcode = '42501';
  end if;
  if p.kind <> 'solution_idea' then
    raise exception 'build_proposal: only a solution idea can be built' using errcode = '22023';
  end if;
  if p.status <> 'pending' then
    raise exception 'build_proposal: that idea has already been dealt with' using errcode = '22023';
  end if;

  -- The solution, as A49 saves it (its own checks and row-level security apply).
  result := public.save_solution(p_workspace, p_process, p_base_revision, p_name, p_steps, p_changed, p_levers, p_links);

  perform set_config('transpera.reviewing_proposals', 'on', true);
  update public.suggestion_proposals x
    set status = 'built', applied = jsonb_build_object('solution_id', result ->> 'id'), reviewed_by = auth.uid(), reviewed_at = now()
  where x.id = p_proposal;
  perform set_config('transpera.reviewing_proposals', '', true);
  return result;
end;
$$;

revoke all on function public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261125500000', 'build_proposal', array[$mig$-- Build a solution idea (issue #117, ticket A52, slice 2 of 2; PRD §7.1c).
--
-- "Build it" on a solution idea opens the Editor in solution mode with the idea's steps placed. Saving turns it into a real
-- solution through `public.save_solution` (A49), and the idea is marked `built`, in the same transaction, so an idea is never
-- built twice and a solution is never saved without the idea knowing. This adds the one function that does both:
--
--   * `public.build_proposal(p_proposal, p_workspace, p_process, p_base_revision, p_name, p_steps, p_changed, p_levers,
--     p_links)`: security invoker, so row-level security applies to everything it writes. It locks the proposal (it must be a
--     pending solution idea of that workspace), calls `save_solution` with the rest, then sets the proposal to `built` with
--     `applied = {solution_id}` and who and when. The decision columns change only here and in `review_proposals`: the guard
--     trigger (`private.suggestion_proposals_before_write`) is unchanged. An API-token request (the MCP server) can't build: a
--     person decides, as with `review_proposals`.
--
-- The solution's origin is recorded on the idea (`applied.solution_id`), not on `solutions`, so the solutions table is not
-- touched. A solution made from an AI idea is one whose id is in `suggestion_proposals.applied ->> 'solution_id'` with status
-- `built`: A50's "Type: AI block" label can read it from there.
--
-- STRICTLY ADDITIVE: one function. No table, column, constraint, trigger or existing function is changed. Needs 20261122000000
-- (`save_solution`) and 20261124000000 (`suggestion_proposals`).
--
-- Preflight (run with `bash packages/db/scripts/prod-sql.sh -c "..."`; each should be as described):
--
--   1. The function does not exist yet. Expect 0:
--        select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'build_proposal';
--   2. Nothing of ours is applied past this one. Expect 0 rows:
--        select version from supabase_migrations.schema_migrations where version >= '20261125500000';
--   3. save_solution and the proposals table exist. Expect 2 rows:
--        select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_solution'
--        union all select table_name from information_schema.tables where table_schema = 'public' and table_name = 'suggestion_proposals';
--
-- Post-apply grant check (authenticated may execute it, anon may not):
--        select grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'build_proposal' and grantee in ('anon', 'authenticated', 'public') order by 1;
--   Expect: one row, authenticated EXECUTE.
--
-- Rollback (run as one transaction; nothing existing was changed):
--
--   begin;
--   drop function if exists public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb);
--   delete from supabase_migrations.schema_migrations where version = '20261125500000';
--   commit;
--
-- Ideas already built stay `built` and keep their `applied.solution_id`; solutions they made stay.
--
-- Production data: none needed.

create function public.build_proposal(
  p_proposal uuid, p_workspace uuid, p_process uuid, p_base_revision uuid, p_name text, p_steps jsonb, p_changed jsonb,
  p_levers jsonb, p_links jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.suggestion_proposals;
  result jsonb;
begin
  if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
    raise exception 'Ideas are built by a person in the app, not over the API' using errcode = '42501';
  end if;
  -- Every column but the visitor's email, which this role can't read (position matters: it is the table's order).
  select x.id, x.workspace_id, x.kind, x.title, x.detail, x.payload, x.evidence, x.note, x.issue_id, x.status, x.created_via,
    x.proposer_name, null::text, x.applied, x.review_note, x.reviewed_by, x.reviewed_at, x.created_at, x.updated_at, x.created_by
    into p from public.suggestion_proposals x where x.id = p_proposal and x.workspace_id = p_workspace for update;
  if p.id is null then
    raise exception 'build_proposal: no such idea' using errcode = '42501';
  end if;
  if p.kind <> 'solution_idea' then
    raise exception 'build_proposal: only a solution idea can be built' using errcode = '22023';
  end if;
  if p.status <> 'pending' then
    raise exception 'build_proposal: that idea has already been dealt with' using errcode = '22023';
  end if;

  -- The solution, as A49 saves it (its own checks and row-level security apply).
  result := public.save_solution(p_workspace, p_process, p_base_revision, p_name, p_steps, p_changed, p_levers, p_links);

  perform set_config('transpera.reviewing_proposals', 'on', true);
  update public.suggestion_proposals x
    set status = 'built', applied = jsonb_build_object('solution_id', result ->> 'id'), reviewed_by = auth.uid(), reviewed_at = now()
  where x.id = p_proposal;
  perform set_config('transpera.reviewing_proposals', '', true);
  return result;
end;
$$;

revoke all on function public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.build_proposal(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
$mig$]);

commit;
