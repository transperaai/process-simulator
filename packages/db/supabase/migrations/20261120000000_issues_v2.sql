-- Issues v2: data (issue #112, ticket A47). An issue is a problem someone confirmed, from acknowledging an insight
-- or added by hand. This migration reshapes the register's data; the Acknowledge dialog (apps/web) writes it.
--
-- What is new, all next to the existing `issues` table:
--
--   * `issue_links`: what an issue touches. A row with a null `step_id` is the whole process; rows with a `step_id`
--     are steps (a step's stable id, so no foreign key: steps are keyed by revision). An issue may touch several
--     steps, even in different processes. `issues.process_id` and `issues.step_id` stay, as the first link, for
--     compatibility (the app and the MCP server still read them); `save_issue` keeps them in step.
--   * `issue_owners`: several owners, people. `issues.owner_person_id` stays as the first owner.
--   * `issue_sources`: linked sources. (`issues.evidence_sources` stays, unused by new code.)
--   * `issues.target_measure`, `target_now`, `target_goal`: "Wait at Check fit", "1.4 d", "under 4 hours". Free text,
--     so a person writes it the way they say it.
--   * `issues.number`: a stable number per workspace (Issue #12), assigned by a trigger from `private.issue_counters`
--     (one row per workspace, `update ... returning` takes the row lock, so two inserts never share a number). A
--     number is never reused, even after the issue is deleted, and can't be changed.
--   * Statuses: `open`, `testing` (Testing solutions), `resolved`, `wont_fix` (Won't fix), and `dismissed`.
--     Existing rows map `in_progress` -> `testing`, `done` -> `resolved`; `open` and `dismissed` stay.
--     `dismissed` is not one of the four statuses a person sees: it is what A45 stores for an insight someone
--     dismissed (a tracked row, so the insight stays gone next run). It is never an issue: the register, the map,
--     the counts and the insight list leave `status = 'dismissed'` out, and nothing in the app lets a person pick it.
--     `resolved_at` is set for `resolved`, `wont_fix` and `dismissed`, as it was for `done` and `dismissed`.
--   * `issue_events`: the history log. created, edited, solution_tested, resolved, reopened, each with a date
--     (`at`) and who (`actor`, null for a system change), and a `detail` (changed fields, status from and to).
--     Written only by triggers (security definer) on `issues` and on the three link tables, so every change logs
--     whichever way it is made (the app's actions, `save_fields`, a direct update, the MCP server) and nobody can
--     edit or forge a row. A link change is not logged again when the same transaction already logged that issue.
--   * `public.save_issue(...)`: one call that creates or edits an issue with its links, owners and sources in one
--     transaction (so one history entry), as the signed-in user (security invoker: RLS applies).
--
-- Severity: the `severity` column already holds the four ratings (critical = Operational risk, serious = Bad, warning =
-- Good could improve, info = Great; engine `ratingOfStored`, A41). No data changes; the migration test checks it.
--
-- Existing issues are migrated in place: their step and process become `issue_links` rows (a step's process looked
-- up from `steps` when the issue didn't name one), their owner an `issue_owners` row, their cited sources
-- `issue_sources` rows, they get numbers in the order they were logged (oldest first), and each gets a `created`
-- event at its `created_at` (plus `resolved` at `resolved_at` for the closed ones).
--
-- `save_fields` is not redefined: `issues` is already in its allow-list, and a status edit through it now logs too.
--
-- Strictly additive: five new tables, five columns, one function; the status check is replaced by a wider one.
--
-- Preflight (run first, each should be as described):
--   1. No other status than the old four exists. Expect 0 rows:
--        select status, count(*) from public.issues where status not in ('open','in_progress','done','dismissed') group by 1;
--   2. Nothing of ours is applied past this one. Expect 0 rows:
--        select version from supabase_migrations.schema_migrations where version >= '20261120000000';
--   3. A look at what will be migrated (counts per status and how many name a step or an owner):
--        select status, count(*), count(step_id) as with_step, count(owner_person_id) as with_owner from public.issues group by 1;
--
-- Rollback (run as one transaction; the old status values come back, `testing` as `in_progress`, `resolved` as `done`;
-- `wont_fix` has no old equivalent and becomes `dismissed`, which hides it, so copy those rows somewhere first if
-- they matter):
--
--   begin;
--   drop function if exists public.save_issue(uuid, uuid, jsonb, jsonb, uuid[], uuid[]);
--   drop table if exists public.issue_events, public.issue_sources, public.issue_owners, public.issue_links;
--   drop trigger if exists issue_log on public.issues;
--   drop function if exists private.log_issue_change();
--   drop function if exists private.log_issue_link_change();
--   drop table if exists private.issue_counters;
--   drop function if exists private.next_issue_number(uuid);
--   alter table public.issues disable trigger issues_before_write;
--   alter table public.issues disable trigger set_updated_at;
--   alter table public.issues drop constraint issues_status;
--   update public.issues set status = case status when 'testing' then 'in_progress' when 'resolved' then 'done'
--     when 'wont_fix' then 'dismissed' else status end;
--   alter table public.issues add constraint issues_status check (status in ('open', 'in_progress', 'done', 'dismissed'));
--   alter table public.issues drop constraint issues_target_lengths;
--   alter table public.issues drop column number, drop column target_measure, drop column target_now, drop column target_goal;
--   alter table public.issues enable trigger set_updated_at;
--   -- restore private.issues_before_write() from 20261005000000_issues.sql (create or replace; its done/dismissed logic), then:
--   alter table public.issues enable trigger issues_before_write;
--   delete from supabase_migrations.schema_migrations where version = '20261120000000';
--   commit;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.issues
  add column number integer,
  add column target_measure text,
  add column target_now text,
  add column target_goal text,
  add constraint issues_target_lengths check (
    char_length(target_measure) <= 200 and char_length(target_now) <= 200 and char_length(target_goal) <= 200);

-- ---------------------------------------------------------------------------
-- Numbers
-- ---------------------------------------------------------------------------

create table private.issue_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  last_number integer not null
);
revoke all on private.issue_counters from public, anon, authenticated;

-- The row lock taken by the upsert makes concurrent inserts for one workspace take turns.
create function private.next_issue_number(ws uuid) returns integer
language sql
security definer
set search_path = ''
as $$
  insert into private.issue_counters (workspace_id, last_number) values (ws, 1)
  on conflict (workspace_id) do update set last_number = private.issue_counters.last_number + 1
  returning last_number;
$$;
revoke all on function private.next_issue_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The write trigger: status values, resolved_at, the number
-- ---------------------------------------------------------------------------

-- Replaces the one from 20261005000000_issues.sql: `source` and `detected_key` stay fixed, `resolved_at` follows the
-- status (now `resolved`, `wont_fix` and `dismissed`), and `number` is assigned on insert and then fixed. Security
-- definer, so the writer needs no access to the private counter table.
create or replace function private.issues_before_write() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.source is distinct from old.source or new.detected_key is distinct from old.detected_key then
      raise exception 'issues: source and detected_key cannot be changed' using errcode = '23514';
    end if;
    if old.number is not null and new.number is distinct from old.number then
      raise exception 'issues: the number cannot be changed' using errcode = '23514';
    end if;
    if new.status in ('resolved', 'wont_fix', 'dismissed') then
      new.resolved_at := case when old.status in ('resolved', 'wont_fix', 'dismissed') then old.resolved_at else now() end;
    else
      new.resolved_at := null;
    end if;
  else
    new.number := private.next_issue_number(new.workspace_id);
    new.resolved_at := case when new.status in ('resolved', 'wont_fix', 'dismissed') then now() else null end;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Link tables
-- ---------------------------------------------------------------------------

create table public.issue_links (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  workspace_id uuid not null,
  -- The process the step is in; the process itself when step_id is null. Null only for a step whose process isn't known.
  process_id uuid,
  -- A step's stable id (no foreign key: steps are keyed by revision). Null: the whole process.
  step_id uuid,
  created_at timestamptz not null default now(),
  constraint issue_links_something check (process_id is not null or step_id is not null),
  foreign key (issue_id, workspace_id) references public.issues (id, workspace_id) on delete cascade,
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade
);
create unique index issue_links_unique on public.issue_links
  (issue_id, coalesce(process_id, '00000000-0000-0000-0000-000000000000'), coalesce(step_id, '00000000-0000-0000-0000-000000000000'));
create index on public.issue_links (workspace_id, step_id);
create index on public.issue_links (workspace_id, process_id);

create table public.issue_owners (
  issue_id uuid not null,
  person_id uuid not null,
  workspace_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, person_id),
  foreign key (issue_id, workspace_id) references public.issues (id, workspace_id) on delete cascade,
  foreign key (person_id, workspace_id) references public.people (id, workspace_id) on delete cascade
);
create index on public.issue_owners (workspace_id, person_id);

create table public.issue_sources (
  issue_id uuid not null,
  source_id uuid not null,
  workspace_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, source_id),
  foreign key (issue_id, workspace_id) references public.issues (id, workspace_id) on delete cascade,
  foreign key (source_id, workspace_id) references public.sources (id, workspace_id) on delete cascade
);
create index on public.issue_sources (workspace_id, source_id);

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  workspace_id uuid not null,
  -- The order they happened in (`at` can tie inside one transaction).
  seq bigint generated always as identity,
  kind text not null constraint issue_events_kind check (kind in ('created', 'edited', 'solution_tested', 'resolved', 'reopened')),
  at timestamptz not null default clock_timestamp(),
  -- Who did it; null for a change made outside a signed-in session, or by a user since deleted.
  actor uuid references auth.users (id) on delete set null,
  -- What changed: {"fields": [...]} for an edit, {"from": "...", "to": "..."} for a status change, {"linked": "..."} for a link.
  detail jsonb not null default '{}' constraint issue_events_detail_shape check (jsonb_typeof(detail) = 'object'),
  -- The transaction that wrote it: a link change isn't logged again in a transaction that already logged the issue.
  tx bigint default txid_current(),
  foreign key (issue_id, workspace_id) references public.issues (id, workspace_id) on delete cascade
);
create index on public.issue_events (issue_id, seq);
create index on public.issue_events (workspace_id, at);

-- Every change to an issue logs: one trigger on the row, one on each link table. Security definer, so the log is
-- written whoever the caller is and nobody else can write it.
create function private.log_issue_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[];
begin
  if tg_op = 'INSERT' then
    insert into public.issue_events (issue_id, workspace_id, kind, actor, detail)
      values (new.id, new.workspace_id, 'created', auth.uid(), jsonb_build_object('status', new.status));
    return null;
  end if;

  -- process_id, step_id and owner_person_id mirror the link tables, which log their own changes.
  select coalesce(array_agg(f order by f), '{}') into fields from (
    select 'title' f where new.title is distinct from old.title
    union all select 'type' where new.type is distinct from old.type
    union all select 'severity' where new.severity is distinct from old.severity
    union all select 'evidence' where new.evidence is distinct from old.evidence
    union all select 'scenario_id' where new.scenario_id is distinct from old.scenario_id
    union all select 'role_id' where new.role_id is distinct from old.role_id
    union all select 'person_id' where new.person_id is distinct from old.person_id
    union all select 'client_id' where new.client_id is distinct from old.client_id
    union all select 'target_measure' where new.target_measure is distinct from old.target_measure
    union all select 'target_now' where new.target_now is distinct from old.target_now
    union all select 'target_goal' where new.target_goal is distinct from old.target_goal
  ) changed;

  if new.status is distinct from old.status then
    insert into public.issue_events (issue_id, workspace_id, kind, actor, detail) values (
      new.id, new.workspace_id,
      case
        when new.status = 'testing' and old.status = 'open' then 'solution_tested'
        when new.status in ('resolved', 'wont_fix') then 'resolved'
        when old.status in ('resolved', 'wont_fix') and new.status in ('open', 'testing') then 'reopened'
        else 'edited'
      end,
      auth.uid(), jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if cardinality(fields) > 0 then
    insert into public.issue_events (issue_id, workspace_id, kind, actor, detail)
      values (new.id, new.workspace_id, 'edited', auth.uid(), jsonb_build_object('fields', to_jsonb(fields)));
  end if;
  return null;
end;
$$;
revoke all on function private.log_issue_change() from public, anon, authenticated;

create trigger issue_log after insert or update on public.issues
  for each row execute function private.log_issue_change();

-- A change to what an issue touches, who owns it or its sources: one 'edited' event, unless this transaction already
-- logged the issue (a create or an edit through save_issue), or the issue itself is being deleted.
create function private.log_issue_link_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_issue uuid := coalesce(new.issue_id, old.issue_id);
  row_workspace uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if exists (select 1 from public.issues where id = row_issue)
     and not exists (select 1 from public.issue_events where issue_id = row_issue and tx = txid_current()) then
    insert into public.issue_events (issue_id, workspace_id, kind, actor, detail)
      values (row_issue, row_workspace, 'edited', auth.uid(), jsonb_build_object('linked', tg_argv[0]));
  end if;
  return null;
end;
$$;
revoke all on function private.log_issue_link_change() from public, anon, authenticated;

create trigger issue_log after insert or delete on public.issue_links
  for each row execute function private.log_issue_link_change('steps');
create trigger issue_log after insert or delete on public.issue_owners
  for each row execute function private.log_issue_link_change('owners');
create trigger issue_log after insert or delete on public.issue_sources
  for each row execute function private.log_issue_link_change('sources');

-- ---------------------------------------------------------------------------
-- Migrate the existing issues (the log triggers are switched off while the data moves, so no spurious events are
-- written; the real history is backfilled below)
-- ---------------------------------------------------------------------------

alter table public.issues disable trigger set_updated_at;
alter table public.issues disable trigger issues_before_write;
alter table public.issues disable trigger issue_log;
alter table public.issue_links disable trigger issue_log;
alter table public.issue_owners disable trigger issue_log;
alter table public.issue_sources disable trigger issue_log;

alter table public.issues drop constraint issues_status;
update public.issues set status = case status when 'in_progress' then 'testing' when 'done' then 'resolved' else status end
  where status in ('in_progress', 'done');
alter table public.issues add constraint issues_status check (status in ('open', 'testing', 'resolved', 'wont_fix', 'dismissed'));

-- Numbers, oldest first.
with ranked as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as n from public.issues
)
update public.issues i set number = ranked.n from ranked where i.id = ranked.id;
insert into private.issue_counters (workspace_id, last_number)
  select workspace_id, max(number) from public.issues group by workspace_id;
alter table public.issues alter column number set not null;
alter table public.issues add constraint issues_workspace_number_key unique (workspace_id, number);

-- What each touches: its step (with the step's process when the issue didn't name one), else its process.
insert into public.issue_links (issue_id, workspace_id, process_id, step_id)
  select i.id, i.workspace_id,
    coalesce(i.process_id, (select s.process_id from public.steps s where s.id = i.step_id and s.workspace_id = i.workspace_id limit 1)),
    i.step_id
  from public.issues i
  where i.step_id is not null or i.process_id is not null
  on conflict do nothing;

insert into public.issue_owners (issue_id, person_id, workspace_id)
  select id, owner_person_id, workspace_id from public.issues where owner_person_id is not null
  on conflict do nothing;

-- Sources the old evidence_sources citations name, where the source still exists.
insert into public.issue_sources (issue_id, source_id, workspace_id)
  select distinct i.id, s.id, i.workspace_id
  from public.issues i
  cross join lateral jsonb_array_elements(i.evidence_sources) as e(value)
  join public.sources s on s.workspace_id = i.workspace_id
    and jsonb_typeof(e.value) = 'object'
    and (e.value ->> 'source_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and s.id = (e.value ->> 'source_id')::uuid
  on conflict do nothing;

-- Their history so far: created, and resolved for the closed ones. (actor: the creator; the resolver isn't recorded.)
insert into public.issue_events (issue_id, workspace_id, kind, at, actor, detail, tx)
  select id, workspace_id, 'created', created_at, created_by, jsonb_build_object('status', status, 'migrated', true), null from public.issues;
insert into public.issue_events (issue_id, workspace_id, kind, at, actor, detail, tx)
  select id, workspace_id, 'resolved', resolved_at, null, jsonb_build_object('to', status, 'migrated', true), null
  from public.issues where status in ('resolved', 'wont_fix') and resolved_at is not null;

alter table public.issues enable trigger set_updated_at;
alter table public.issues enable trigger issues_before_write;
alter table public.issues enable trigger issue_log;
alter table public.issue_links enable trigger issue_log;
alter table public.issue_owners enable trigger issue_log;
alter table public.issue_sources enable trigger issue_log;

-- ---------------------------------------------------------------------------
-- Row-level security: the issues policies, for every new table
-- ---------------------------------------------------------------------------

-- Everyone in the workspace reads; editors, owners and agency admins change what an issue links to (not the rows
-- of a detected issue, which are the engine's). Nobody writes the history through the API.
alter table public.issue_links enable row level security;
alter table public.issue_owners enable row level security;
alter table public.issue_sources enable row level security;
alter table public.issue_events enable row level security;

create policy "read issue_links" on public.issue_links for select to authenticated using (public.can_read_workspace(workspace_id));
create policy "read issue_owners" on public.issue_owners for select to authenticated using (public.can_read_workspace(workspace_id));
create policy "read issue_sources" on public.issue_sources for select to authenticated using (public.can_read_workspace(workspace_id));
create policy "read issue_events" on public.issue_events for select to authenticated using (public.can_read_workspace(workspace_id));

create policy "insert issue_links" on public.issue_links for insert to authenticated
  with check (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));
create policy "delete issue_links" on public.issue_links for delete to authenticated
  using (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));
create policy "insert issue_owners" on public.issue_owners for insert to authenticated
  with check (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));
create policy "delete issue_owners" on public.issue_owners for delete to authenticated
  using (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));
create policy "insert issue_sources" on public.issue_sources for insert to authenticated
  with check (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));
create policy "delete issue_sources" on public.issue_sources for delete to authenticated
  using (public.can_edit_workspace(workspace_id)
    and not exists (select 1 from public.issues i where i.id = issue_id and i.source = 'detected'));

grant select, insert, delete on public.issue_links, public.issue_owners, public.issue_sources to authenticated;
grant select on public.issue_events to authenticated;
revoke all on public.issue_links, public.issue_owners, public.issue_sources, public.issue_events from anon;

-- ---------------------------------------------------------------------------
-- save_issue: create or edit an issue with its links, owners and sources, in one transaction
-- ---------------------------------------------------------------------------

-- p_id null creates; otherwise edits that issue. p_fields holds only the columns to set (the allow-list below).
-- p_links is [{"process_id": uuid|null, "step_id": uuid|null}, ...], p_owners and p_sources are arrays of ids; null
-- leaves the existing set alone, an array replaces it (only the differences are written, so an unchanged save writes
-- no history). Returns the issue row. Security invoker: row-level security applies to every write, and the caller must be
-- able to edit the workspace (checked first, so a viewer's save fails loudly instead of changing nothing).
create function public.save_issue(p_workspace uuid, p_id uuid, p_fields jsonb, p_links jsonb, p_owners uuid[], p_sources uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  settable constant text[] := array['title', 'type', 'severity', 'evidence', 'status', 'scenario_id', 'role_id', 'person_id',
    'client_id', 'target_measure', 'target_now', 'target_goal'];
  creatable constant text[] := array['source', 'detected_key', 'evidence_metrics'];
  field text;
  cols text;
  v_issue uuid := p_id;
  first_link record;
  result jsonb;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' then
    raise exception 'save_issue: fields must be an object' using errcode = '22023';
  end if;
  if not coalesce(public.can_edit_workspace(p_workspace), false) then
    raise exception 'save_issue: you cannot change issues in this workspace' using errcode = '42501';
  end if;
  for field in select jsonb_object_keys(p_fields) loop
    if not (field = any (settable) or (p_id is null and field = any (creatable))) then
      raise exception 'save_issue: % cannot be set', field using errcode = '42501';
    end if;
  end loop;
  if p_links is not null and jsonb_typeof(p_links) <> 'array' then
    raise exception 'save_issue: links must be an array' using errcode = '22023';
  end if;

  if p_id is null then
    if not p_fields ? 'title' then
      raise exception 'save_issue: a title is required' using errcode = '22023';
    end if;
    -- An issue logged without a type is an audit finding.
    if not p_fields ? 'type' then
      p_fields := p_fields || '{"type": "manual"}';
    end if;
  end if;

  select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(p_fields) as k;

  if p_id is null then
    execute format(
      'insert into public.issues (workspace_id, %1$s) select $1, %1$s from jsonb_populate_record(null::public.issues, $2) returning id',
      cols)
    into v_issue using p_workspace, p_fields;
  else
    if not exists (select 1 from public.issues where id = p_id and workspace_id = p_workspace) then
      raise exception 'save_issue: no such issue' using errcode = '42501';
    end if;
    if cols is not null then
      execute format(
        'update public.issues set (%1$s) = (select %1$s from jsonb_populate_record(null::public.issues, $3)) where id = $1 and workspace_id = $2',
        cols)
      using p_id, p_workspace, p_fields;
    end if;
  end if;

  if p_links is not null then
    delete from public.issue_links l where l.issue_id = v_issue and not exists (
      select 1 from jsonb_to_recordset(p_links) as n(process_id uuid, step_id uuid)
      where n.process_id is not distinct from l.process_id and n.step_id is not distinct from l.step_id);
    insert into public.issue_links (issue_id, workspace_id, process_id, step_id)
      select v_issue, p_workspace, n.process_id, n.step_id
      from jsonb_to_recordset(p_links) as n(process_id uuid, step_id uuid)
      where not exists (select 1 from public.issue_links l where l.issue_id = v_issue
        and l.process_id is not distinct from n.process_id and l.step_id is not distinct from n.step_id);
    -- The compatibility columns: the first link given.
    select (e.v ->> 'process_id')::uuid as process_id, (e.v ->> 'step_id')::uuid as step_id into first_link
      from jsonb_array_elements(p_links) with ordinality as e(v, ord) order by e.ord limit 1;
    update public.issues set process_id = first_link.process_id, step_id = first_link.step_id where id = v_issue;
  end if;

  if p_owners is not null then
    delete from public.issue_owners o where o.issue_id = v_issue and not (o.person_id = any (p_owners));
    insert into public.issue_owners (issue_id, person_id, workspace_id)
      select v_issue, p, p_workspace from unnest(p_owners) as p on conflict do nothing;
    update public.issues set owner_person_id = p_owners[1] where id = v_issue;
  end if;

  if p_sources is not null then
    delete from public.issue_sources s where s.issue_id = v_issue and not (s.source_id = any (p_sources));
    insert into public.issue_sources (issue_id, source_id, workspace_id)
      select v_issue, p, p_workspace from unnest(p_sources) as p on conflict do nothing;
  end if;

  select to_jsonb(i) into result from public.issues i where i.id = v_issue;
  return result;
end;
$$;

revoke all on function public.save_issue(uuid, uuid, jsonb, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.save_issue(uuid, uuid, jsonb, jsonb, uuid[], uuid[]) to authenticated;
