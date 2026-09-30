# Production migrations

Every migration in `packages/db/supabase/migrations/`, in the order production applies them (the order of
`version` in `supabase_migrations.schema_migrations`, which is the order of the file names). Keep this table up to
date when a migration lands or is applied.

- **Applied** is the day the migration reached `main`: `supabase_migrations.schema_migrations` records each
  migration's `version`, `name` and `statements` but no timestamp, so it can't give a date. Put the real date in
  when you apply one, if you know it.
- **PR** is the pull request that merged it into `main`. Six migrations reached `main` together in the overnight
  integration PR #69; the feature PR each came from is in brackets.
- **Rollback** summarises the SQL in the migration's header comment. Where the header has full rollback SQL, run
  that; every rollback ends by deleting the migration's row from `supabase_migrations.schema_migrations`. Roll back
  newest first: later migrations redefine `save_fields` and depend on earlier tables.

| # | Version | Name | Applied | PR | Rollback summary |
|---|---|---|---|---|---|
| 1 | 20260929000000 | init | 2026-09-29 | #45 (#4) | No header rollback: it creates the base schema (`workspaces`, `memberships`, `roles`, `processes`, `process_revisions`, `steps`, `edges`, `set_updated_at`, RLS helpers). Rolling back means dropping the whole schema; restore from a backup instead. |
| 2 | 20260929010000 | people | 2026-09-29 | #45 (#6) | No header rollback. Drop `person_leave`, `person_skills`, `person_roles`, `people` and the pinned-assignee foreign key on `steps`. |
| 3 | 20260930000000 | field_saves | 2026-09-29 | #53 | No header rollback. Drop functions `public.save_fields` and `public.save_links` (the app's per-field saves stop working). |
| 4 | 20260930030000 | workspace_access | 2026-09-29 | #55 (#51) | No header rollback. Drop `workspace_domains`, `workspace_access_emails`, `audit_log` and their triggers and functions, and restore the earlier `workspace_role` and membership policies from `init`. |
| 5 | 20260930040000 | api_tokens | 2026-09-29 | #54 (#23) | No header rollback. Reset the `authenticator` role's `pgrst.db_pre_request` and `notify pgrst, 'reload config'`, then drop `api_tokens`, the `private.*api_token*` functions and `public.use_api_token` (MCP tokens stop working). |
| 6 | 20261001000000 | services | 2026-09-30 | #69 (#59, #12) | `drop table public.services`; re-run `save_fields` from `field_saves` (or leave it). |
| 7 | 20261002000000 | scenarios | 2026-09-30 | #69 (#61, #15) | Drop the `seed_scenario_library` trigger on `workspaces`, table `scenarios`, and `private.seed_scenario_library`, `private.scenario_library`, `private.is_scenario_patch`. |
| 8 | 20261004000000 | demand | 2026-09-30 | #69 (#63, #13) | Drop `lead_sources`, `seasonality`, `demand_settings` and `public.stamp_provenance()`; re-run `save_fields` from `services` (or leave it). Note: `clients` (#18) also uses `stamp_provenance`, so roll #18 back first. |
| 9 | 20261005000000 | issues | 2026-09-30 | #69 (#64, #17) | Drop `issues` and `private.issues_before_write()`; re-run `save_fields` from `demand`. |
| 10 | 20261006000000 | drafts | 2026-09-30 | #69 (#65, #9) | Drop the audit and `edit_drafts_only` triggers, `open_draft`, `publish_process`, `discard_draft`, `audit_revision_change`, `edit_drafts_only`, `private.revision_changes` and the one-draft/one-published indexes (see the header). |
| 11 | 20261007000000 | realtime | 2026-09-30 | #69 (#68, #10) | Remove `steps`, `edges`, `processes` from the `supabase_realtime` publication and drop the two `realtime.messages` policies for `process:` channels. |
| 12 | 20261009000000 | sources | 2026-09-30 | #73 (#21) | Drop the `log_perception_gaps` and `flag_conflicts` triggers on `steps`, `private.log_perception_gaps`, `private.flag_conflicts`, `private.has_open_conflict` and table `sources`; re-run `save_fields` from `issues`. Perception-gap issues it logged stay in `issues`. |
| 13 | 20261012000000 | clients | pending | pending (#18, branch `feat/18-clients`) | `alter table public.issues drop column client_id`; drop `client_assignments`, `client_services`, `clients`; re-run `save_fields` from `sources` and `save_links` from `field_saves` (or leave them). After applying, run the commented "Production data alignment" block at the end of the file (Northbeam's roster, fallback loads, 10% overtime cap; idempotent). |
| 14 | 20261015000000 | suggestions | pending | pending (#25, branch `feat/25-suggestions`) | Drop `review_suggestions`, `private.apply_suggestion`, tables `runs` and `suggestions`, the `audit_company` and `needs_review` triggers on the company-model tables, the `stamp_provenance` triggers on `people` and `services`, `stamp_settings_provenance` on `workspaces`, their private functions, and the `provenance` columns on `workspaces`, `people` and `services` (full SQL in the header). Deletes every suggestion and saved run. No production data alignment needed. |
