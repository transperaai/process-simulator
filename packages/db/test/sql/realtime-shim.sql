-- Minimal stand-in for the parts of Supabase Realtime the migrations touch:
-- the `supabase_realtime` publication, and realtime.messages with
-- realtime.topic(), which Realtime Authorization checks policies against
-- (Realtime sets `realtime.topic` for the channel being joined, then tries a
-- select / insert on realtime.messages as the user). Test-only: loaded before
-- the migrations by tests that ask for it, never run against Supabase.

create publication supabase_realtime;

create schema realtime;
grant usage on schema realtime to authenticated;

create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;

create function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text;
$$;
