begin;

-- Cost per month (docs/analysis-rules.md "Cost per month"; issue #108).
--
-- Two small changes:
--   * New workspaces default to AUD. `public.create_workspace` is redefined as
--     a copy of the 20261021000000 version whose default settings carry
--     "currency":"AUD" instead of "GBP". Existing workspaces keep their
--     currency (nothing here touches `workspaces` rows), and a caller can still
--     pass any three-letter code.
--   * Each step gets an optional `lost_per_day`: the share of items that go cold
--     for each working day they wait there (0.05 is 5% of leads a day). The
--     "waiting too long" insight costs money through it (items lost × what a
--     loss is worth at that step); with none set the insight shows time instead.
--     `save_fields` accepts any column the stored row has, so it needs nothing.
--
-- Strictly additive: one nullable column with a check, and a function
-- replaced by a copy that differs only in the default currency.
--
-- Preflight (run each with `bash packages/db/scripts/prod-sql.sh -c "..."`):
--
--   1. The column must not exist yet. Expect 0 rows:
--        select column_name from information_schema.columns
--        where table_schema='public' and table_name='steps' and column_name='lost_per_day';
--   2. The function is the 20261021000000 one (it has the 'GBP' default). Expect 1 row:
--        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='create_workspace' and pg_get_functiondef(p.oid) like '%"currency":"GBP"%';
--   3. Nothing of ours is applied past roles_and_workspaces. Expect only `20261021000000`:
--        select version from supabase_migrations.schema_migrations where version >= '20261021000000';
--
-- Rollback (run as one transaction):
--
--   begin;
--   alter table public.steps drop constraint if exists steps_lost_per_day;
--   alter table public.steps drop column if exists lost_per_day;
--   -- Restore the GBP default: the same function with "currency":"GBP".
--   create or replace function public.create_workspace(ws_name text, ws_slug text, ws_settings jsonb default '{}')
--   returns uuid
--   language plpgsql
--   security invoker
--   set search_path = ''
--   as $$
--   declare
--     ws uuid;
--     k text;
--     defaults constant jsonb := '{"hours_per_week":40,"horizon_weeks":13,"currency":"GBP","leads_per_week":0,"active_clients":0,"churn_monthly":0,"retainer":0}';
--   begin
--     if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
--       raise exception 'Workspaces are created in the app' using errcode = '42501';
--     end if;
--     if auth.uid() is null or not public.is_agency_admin() then
--       raise exception 'Only agency admins can create workspaces' using errcode = '42501';
--     end if;
--     if ws_name is null or char_length(btrim(ws_name)) not between 1 and 200 then
--       raise exception 'The name must be 1 to 200 characters' using errcode = '22023';
--     end if;
--     ws_settings := coalesce(ws_settings, '{}');
--     if jsonb_typeof(ws_settings) <> 'object' then
--       raise exception 'settings must be an object' using errcode = '22023';
--     end if;
--     for k in select jsonb_object_keys(ws_settings) loop
--       if k not in ('hours_per_week', 'horizon_weeks', 'currency') then
--         raise exception '% can''t be set when creating a workspace', k using errcode = '22023';
--       end if;
--     end loop;
--     if ws_settings ? 'hours_per_week' and not (
--       jsonb_typeof(ws_settings -> 'hours_per_week') = 'number'
--       and (ws_settings ->> 'hours_per_week')::numeric > 0 and (ws_settings ->> 'hours_per_week')::numeric <= 168) then
--       raise exception 'hours_per_week must be a number above 0 and at most 168' using errcode = '22023';
--     end if;
--     if ws_settings ? 'horizon_weeks' and not (
--       jsonb_typeof(ws_settings -> 'horizon_weeks') = 'number'
--       and (ws_settings ->> 'horizon_weeks')::numeric = trunc((ws_settings ->> 'horizon_weeks')::numeric)
--       and (ws_settings ->> 'horizon_weeks')::numeric between 1 and 104) then
--       raise exception 'horizon_weeks must be a whole number from 1 to 104' using errcode = '22023';
--     end if;
--     if ws_settings ? 'currency' and not (
--       jsonb_typeof(ws_settings -> 'currency') = 'string' and (ws_settings ->> 'currency') ~ '^[A-Z]{3}$') then
--       raise exception 'currency must be a three-letter code such as GBP' using errcode = '22023';
--     end if;
--
--     insert into public.workspaces (name, slug, settings)
--     values (btrim(ws_name), ws_slug, defaults || ws_settings)
--     returning id into ws;
--
--     insert into public.memberships (workspace_id, user_id, role, source)
--     values (ws, auth.uid(), 'agency_admin', 'manual');
--
--     return ws;
--   end;
--   $$;
--   delete from supabase_migrations.schema_migrations where version = '20261103000000';
--   commit;
--
-- Production data: none needed. Workspaces already created keep their currency.

-- ---------------------------------------------------------------------------
-- Steps: lost per day of waiting
-- ---------------------------------------------------------------------------

alter table public.steps
  -- The share of items that go cold for each working day they wait at this step (0 to 1); null: not set.
  add column lost_per_day numeric,
  add constraint steps_lost_per_day check (lost_per_day is null or (lost_per_day >= 0 and lost_per_day <= 1));

-- ---------------------------------------------------------------------------
-- Creating a workspace: AUD by default
-- ---------------------------------------------------------------------------

-- Agency admins only, and not over an API token. Runs as the caller, so RLS
-- checks both inserts; `returning` passes the select policy for an admin.
create or replace function public.create_workspace(ws_name text, ws_slug text, ws_settings jsonb default '{}')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws uuid;
  k text;
  defaults constant jsonb := '{"hours_per_week":40,"horizon_weeks":13,"currency":"AUD","leads_per_week":0,"active_clients":0,"churn_monthly":0,"retainer":0}';
begin
  if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
    raise exception 'Workspaces are created in the app' using errcode = '42501';
  end if;
  if auth.uid() is null or not public.is_agency_admin() then
    raise exception 'Only agency admins can create workspaces' using errcode = '42501';
  end if;
  if ws_name is null or char_length(btrim(ws_name)) not between 1 and 200 then
    raise exception 'The name must be 1 to 200 characters' using errcode = '22023';
  end if;
  ws_settings := coalesce(ws_settings, '{}');
  if jsonb_typeof(ws_settings) <> 'object' then
    raise exception 'settings must be an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(ws_settings) loop
    if k not in ('hours_per_week', 'horizon_weeks', 'currency') then
      raise exception '% can''t be set when creating a workspace', k using errcode = '22023';
    end if;
  end loop;
  if ws_settings ? 'hours_per_week' and not (
    jsonb_typeof(ws_settings -> 'hours_per_week') = 'number'
    and (ws_settings ->> 'hours_per_week')::numeric > 0 and (ws_settings ->> 'hours_per_week')::numeric <= 168) then
    raise exception 'hours_per_week must be a number above 0 and at most 168' using errcode = '22023';
  end if;
  if ws_settings ? 'horizon_weeks' and not (
    jsonb_typeof(ws_settings -> 'horizon_weeks') = 'number'
    and (ws_settings ->> 'horizon_weeks')::numeric = trunc((ws_settings ->> 'horizon_weeks')::numeric)
    and (ws_settings ->> 'horizon_weeks')::numeric between 1 and 104) then
    raise exception 'horizon_weeks must be a whole number from 1 to 104' using errcode = '22023';
  end if;
  if ws_settings ? 'currency' and not (
    jsonb_typeof(ws_settings -> 'currency') = 'string' and (ws_settings ->> 'currency') ~ '^[A-Z]{3}$') then
    raise exception 'currency must be a three-letter code such as AUD' using errcode = '22023';
  end if;

  insert into public.workspaces (name, slug, settings)
  values (btrim(ws_name), ws_slug, defaults || ws_settings)
  returning id into ws;

  insert into public.memberships (workspace_id, user_id, role, source)
  values (ws, auth.uid(), 'agency_admin', 'manual');

  return ws;
end;
$$;

revoke all on function public.create_workspace(text, text, jsonb) from public, anon;
grant execute on function public.create_workspace(text, text, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261103000000', 'cost_per_month', array[$mig$-- Cost per month (docs/analysis-rules.md "Cost per month"; issue #108).
--
-- Two small changes:
--   * New workspaces default to AUD. `public.create_workspace` is redefined as
--     a copy of the 20261021000000 version whose default settings carry
--     "currency":"AUD" instead of "GBP". Existing workspaces keep their
--     currency (nothing here touches `workspaces` rows), and a caller can still
--     pass any three-letter code.
--   * Each step gets an optional `lost_per_day`: the share of items that go cold
--     for each working day they wait there (0.05 is 5% of leads a day). The
--     "waiting too long" insight costs money through it (items lost × what a
--     loss is worth at that step); with none set the insight shows time instead.
--     `save_fields` accepts any column the stored row has, so it needs nothing.
--
-- Strictly additive: one nullable column with a check, and a function
-- replaced by a copy that differs only in the default currency.
--
-- Preflight (run each with `bash packages/db/scripts/prod-sql.sh -c "..."`):
--
--   1. The column must not exist yet. Expect 0 rows:
--        select column_name from information_schema.columns
--        where table_schema='public' and table_name='steps' and column_name='lost_per_day';
--   2. The function is the 20261021000000 one (it has the 'GBP' default). Expect 1 row:
--        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='create_workspace' and pg_get_functiondef(p.oid) like '%"currency":"GBP"%';
--   3. Nothing of ours is applied past roles_and_workspaces. Expect only `20261021000000`:
--        select version from supabase_migrations.schema_migrations where version >= '20261021000000';
--
-- Rollback (run as one transaction):
--
--   begin;
--   alter table public.steps drop constraint if exists steps_lost_per_day;
--   alter table public.steps drop column if exists lost_per_day;
--   -- Restore the GBP default: the same function with "currency":"GBP".
--   create or replace function public.create_workspace(ws_name text, ws_slug text, ws_settings jsonb default '{}')
--   returns uuid
--   language plpgsql
--   security invoker
--   set search_path = ''
--   as $$
--   declare
--     ws uuid;
--     k text;
--     defaults constant jsonb := '{"hours_per_week":40,"horizon_weeks":13,"currency":"GBP","leads_per_week":0,"active_clients":0,"churn_monthly":0,"retainer":0}';
--   begin
--     if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
--       raise exception 'Workspaces are created in the app' using errcode = '42501';
--     end if;
--     if auth.uid() is null or not public.is_agency_admin() then
--       raise exception 'Only agency admins can create workspaces' using errcode = '42501';
--     end if;
--     if ws_name is null or char_length(btrim(ws_name)) not between 1 and 200 then
--       raise exception 'The name must be 1 to 200 characters' using errcode = '22023';
--     end if;
--     ws_settings := coalesce(ws_settings, '{}');
--     if jsonb_typeof(ws_settings) <> 'object' then
--       raise exception 'settings must be an object' using errcode = '22023';
--     end if;
--     for k in select jsonb_object_keys(ws_settings) loop
--       if k not in ('hours_per_week', 'horizon_weeks', 'currency') then
--         raise exception '% can''t be set when creating a workspace', k using errcode = '22023';
--       end if;
--     end loop;
--     if ws_settings ? 'hours_per_week' and not (
--       jsonb_typeof(ws_settings -> 'hours_per_week') = 'number'
--       and (ws_settings ->> 'hours_per_week')::numeric > 0 and (ws_settings ->> 'hours_per_week')::numeric <= 168) then
--       raise exception 'hours_per_week must be a number above 0 and at most 168' using errcode = '22023';
--     end if;
--     if ws_settings ? 'horizon_weeks' and not (
--       jsonb_typeof(ws_settings -> 'horizon_weeks') = 'number'
--       and (ws_settings ->> 'horizon_weeks')::numeric = trunc((ws_settings ->> 'horizon_weeks')::numeric)
--       and (ws_settings ->> 'horizon_weeks')::numeric between 1 and 104) then
--       raise exception 'horizon_weeks must be a whole number from 1 to 104' using errcode = '22023';
--     end if;
--     if ws_settings ? 'currency' and not (
--       jsonb_typeof(ws_settings -> 'currency') = 'string' and (ws_settings ->> 'currency') ~ '^[A-Z]{3}$') then
--       raise exception 'currency must be a three-letter code such as GBP' using errcode = '22023';
--     end if;
--
--     insert into public.workspaces (name, slug, settings)
--     values (btrim(ws_name), ws_slug, defaults || ws_settings)
--     returning id into ws;
--
--     insert into public.memberships (workspace_id, user_id, role, source)
--     values (ws, auth.uid(), 'agency_admin', 'manual');
--
--     return ws;
--   end;
--   $$;
--   delete from supabase_migrations.schema_migrations where version = '20261103000000';
--   commit;
--
-- Production data: none needed. Workspaces already created keep their currency.

-- ---------------------------------------------------------------------------
-- Steps: lost per day of waiting
-- ---------------------------------------------------------------------------

alter table public.steps
  -- The share of items that go cold for each working day they wait at this step (0 to 1); null: not set.
  add column lost_per_day numeric,
  add constraint steps_lost_per_day check (lost_per_day is null or (lost_per_day >= 0 and lost_per_day <= 1));

-- ---------------------------------------------------------------------------
-- Creating a workspace: AUD by default
-- ---------------------------------------------------------------------------

-- Agency admins only, and not over an API token. Runs as the caller, so RLS
-- checks both inserts; `returning` passes the select policy for an admin.
create or replace function public.create_workspace(ws_name text, ws_slug text, ws_settings jsonb default '{}')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws uuid;
  k text;
  defaults constant jsonb := '{"hours_per_week":40,"horizon_weeks":13,"currency":"AUD","leads_per_week":0,"active_clients":0,"churn_monthly":0,"retainer":0}';
begin
  if coalesce(auth.jwt(), '{}') ? 'api_token_id' then
    raise exception 'Workspaces are created in the app' using errcode = '42501';
  end if;
  if auth.uid() is null or not public.is_agency_admin() then
    raise exception 'Only agency admins can create workspaces' using errcode = '42501';
  end if;
  if ws_name is null or char_length(btrim(ws_name)) not between 1 and 200 then
    raise exception 'The name must be 1 to 200 characters' using errcode = '22023';
  end if;
  ws_settings := coalesce(ws_settings, '{}');
  if jsonb_typeof(ws_settings) <> 'object' then
    raise exception 'settings must be an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(ws_settings) loop
    if k not in ('hours_per_week', 'horizon_weeks', 'currency') then
      raise exception '% can''t be set when creating a workspace', k using errcode = '22023';
    end if;
  end loop;
  if ws_settings ? 'hours_per_week' and not (
    jsonb_typeof(ws_settings -> 'hours_per_week') = 'number'
    and (ws_settings ->> 'hours_per_week')::numeric > 0 and (ws_settings ->> 'hours_per_week')::numeric <= 168) then
    raise exception 'hours_per_week must be a number above 0 and at most 168' using errcode = '22023';
  end if;
  if ws_settings ? 'horizon_weeks' and not (
    jsonb_typeof(ws_settings -> 'horizon_weeks') = 'number'
    and (ws_settings ->> 'horizon_weeks')::numeric = trunc((ws_settings ->> 'horizon_weeks')::numeric)
    and (ws_settings ->> 'horizon_weeks')::numeric between 1 and 104) then
    raise exception 'horizon_weeks must be a whole number from 1 to 104' using errcode = '22023';
  end if;
  if ws_settings ? 'currency' and not (
    jsonb_typeof(ws_settings -> 'currency') = 'string' and (ws_settings ->> 'currency') ~ '^[A-Z]{3}$') then
    raise exception 'currency must be a three-letter code such as AUD' using errcode = '22023';
  end if;

  insert into public.workspaces (name, slug, settings)
  values (btrim(ws_name), ws_slug, defaults || ws_settings)
  returning id into ws;

  insert into public.memberships (workspace_id, user_id, role, source)
  values (ws, auth.uid(), 'agency_admin', 'manual');

  return ws;
end;
$$;

revoke all on function public.create_workspace(text, text, jsonb) from public, anon;
grant execute on function public.create_workspace(text, text, jsonb) to authenticated;
$mig$]);

commit;
