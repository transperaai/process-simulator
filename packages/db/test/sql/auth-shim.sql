-- Minimal stand-in for the parts of Supabase the migrations rely on, so RLS can
-- be tested against plain Postgres. Mirrors Supabase's definitions of
-- auth.uid() and auth.jwt(). Test-only: never run against a Supabase project.

-- Roles are cluster-wide and test files run in parallel, so tolerate another
-- file creating the same role at the same moment.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    begin
      if not exists (select from pg_roles where rolname = r) then
        execute format('create role %I nologin%s', r, case when r = 'service_role' then ' bypassrls' else '' end);
      end if;
    exception when unique_violation or duplicate_object then
      null;
    end;
  end loop;
end $$;

create schema auth;

create table auth.users (
  id uuid primary key,
  email text unique,
  email_confirmed_at timestamptz default now(),
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}'
);

-- One row per linked provider account; identity_data is written only by Auth.
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null default '{}',
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
