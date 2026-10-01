-- AI analysis (issue #111, A46; docs/analysis-rules.md "What AI does", docs/adr/0013-ai-analysis.md).
--
-- AI runs alongside the rules: it reads a published version's results, rule findings, first principles and (if the
-- workspace lets it) linked sources, and writes a short "AI read of this run", insights marked AI, and a review of the
-- first principles. Every number in what it writes is checked against the run before it is stored (the narration check,
-- docs/adr/0011-narration.md); this migration only stores the outcome.
--
-- Two tables:
--
--   * `ai_settings`: one row per workspace with the five switches on Settings -> AI analysis. No row means the defaults
--     (the column defaults). Written per switch (an upsert of one column), so two people flipping different switches
--     can't undo each other.
--   * `ai_analyses`: one row per process revision (a published or superseded version): the read, the insights, the
--     first-principles review, the number check's counts and the model. Stored so a page view never calls the model;
--     a re-run (publish, a market change, "Run again") replaces the row.
--
-- Access: every member reads; owners and editors write, as the user (the server writes after a publish or a click with
-- the signed-in user's own client, so no SECURITY DEFINER function and no service key is involved). `anon` has nothing.
--
-- Strictly additive: two tables, `set_updated_at` triggers, row-level security and policies. `save_fields`,
-- `publish_process` and every existing table are unchanged.
--
-- Preflight (run with `bash packages/db/scripts/prod-sql.sh -c "..."`):
--
--   1. The tables must not exist yet. Expect 0 rows:
--        select table_name from information_schema.tables
--        where table_schema = 'public' and table_name in ('ai_settings', 'ai_analyses');
--   2. The unique index first_principles added on process_revisions exists. Expect 1 row:
--        select indexname from pg_indexes where indexname = 'process_revisions_id_process_workspace_key';
--   3. Nothing of ours is applied past this one. Expect 0 rows:
--        select version from supabase_migrations.schema_migrations where version >= '20261121000000';
--
-- Rollback (run as one transaction):
--
--   begin;
--   drop table if exists public.ai_analyses;
--   drop table if exists public.ai_settings;
--   delete from supabase_migrations.schema_migrations where version = '20261121000000';
--   commit;
--
-- Production data: none needed (no row means the defaults, and no analysis yet).

create table public.ai_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- Review each version when it is published.
  review_on_publish boolean not null default true,
  -- Review the live versions again when the market conditions change.
  review_on_market boolean not null default true,
  -- Suggest issues, which land in Suggestions (A52; stored now, used when A52 lands).
  suggest_issues boolean not null default true,
  -- Suggest solution ideas that use blocks from the library (A49; stored now, used when A49 lands).
  suggest_solutions boolean not null default true,
  -- Read the sources linked to a process, and quote them. Off until someone turns it on: it sends interview text to the model.
  read_sources boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

create trigger set_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.ai_settings enable row level security;

create policy "read ai_settings" on public.ai_settings for select to authenticated
  using (public.can_read_workspace(workspace_id));
create policy "insert ai_settings" on public.ai_settings for insert to authenticated
  with check (public.can_edit_workspace(workspace_id));
create policy "update ai_settings" on public.ai_settings for update to authenticated
  using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
create policy "delete ai_settings" on public.ai_settings for delete to authenticated
  using (public.can_edit_workspace(workspace_id));

grant select, insert, update, delete on public.ai_settings to authenticated;
revoke all on public.ai_settings from anon;

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  process_id uuid not null,
  revision_id uuid not null,

  -- ok: the model wrote it and it passed the number check. unavailable: no API key or the day's limit. failed: the
  -- model refused, timed out, or every draft cited figures that aren't in the run. `reason` says which, in words.
  status text not null check (status in ('ok', 'unavailable', 'failed')),
  reason text check (reason is null or char_length(reason) <= 2000),
  -- What started it.
  trigger text not null check (trigger in ('publish', 'market', 'manual')),

  -- The AI read: a list of paragraphs (strings).
  summary jsonb not null default '[]'
    check (jsonb_typeof(summary) = 'array' and jsonb_array_length(summary) <= 8 and octet_length(summary::text) <= 65536),
  -- The AI insights that passed the number check, each in the shape of an engine finding (key, type, rating, title,
  -- evidence, step_id ...; apps/web/src/lib/ai/types.ts).
  insights jsonb not null default '[]'
    check (jsonb_typeof(insights) = 'array' and jsonb_array_length(insights) <= 30 and octet_length(insights::text) <= 262144),
  -- The AI's review of the first principles: [{step, level, text}].
  review jsonb not null default '[]'
    check (jsonb_typeof(review) = 'array' and jsonb_array_length(review) <= 40 and octet_length(review::text) <= 131072),

  -- Numbers found in what was kept, each matched to a figure of the run; and items dropped for an unmatched number.
  checked integer not null default 0 check (checked >= 0),
  dropped integer not null default 0 check (dropped >= 0),
  -- The facts the model was given, hashed with the prompt version: the same hash means nothing needs re-running.
  input_hash text not null check (char_length(input_hash) <= 100),
  model text check (model is null or char_length(model) <= 200),
  usage jsonb not null default '[]' check (jsonb_typeof(usage) = 'array' and jsonb_array_length(usage) <= 10),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),

  -- One analysis per version.
  unique (revision_id),
  foreign key (revision_id, process_id, workspace_id) references public.process_revisions (id, process_id, workspace_id) on delete cascade
);

create index on public.ai_analyses (workspace_id, updated_at);
create index on public.ai_analyses (process_id);

create trigger set_updated_at before update on public.ai_analyses
  for each row execute function public.set_updated_at();

alter table public.ai_analyses enable row level security;

create policy "read ai_analyses" on public.ai_analyses for select to authenticated
  using (public.can_read_workspace(workspace_id));
create policy "insert ai_analyses" on public.ai_analyses for insert to authenticated
  with check (public.can_edit_workspace(workspace_id));
create policy "update ai_analyses" on public.ai_analyses for update to authenticated
  using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
create policy "delete ai_analyses" on public.ai_analyses for delete to authenticated
  using (public.can_edit_workspace(workspace_id));

grant select, insert, update, delete on public.ai_analyses to authenticated;
revoke all on public.ai_analyses from anon;
