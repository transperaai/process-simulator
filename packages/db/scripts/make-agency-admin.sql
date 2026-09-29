-- Make an existing user an agency admin (sees every workspace) and give them an
-- agency_admin membership on the Northbeam workspace.
--
-- The user must have signed in once so they exist in auth.users. Run in the
-- Supabase SQL editor (or `psql`) after replacing the email, then have the user
-- sign out and back in so their session picks up the new app_metadata.

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"agency_admin": true}'::jsonb
where email = 'you@example.com';

insert into public.memberships (workspace_id, user_id, role)
select 'a0000000-0000-4000-8000-000000000001', id, 'agency_admin'
from auth.users
where email = 'you@example.com'
on conflict (workspace_id, user_id) do nothing;
