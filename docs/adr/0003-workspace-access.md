# 3. Workspace access by allowed domain and pre-assigned email

Date: 29 Sep 2026 · Status: accepted · Issue: #51 (replaces "invite by email" in #30)

## Context

Client staff sign in with Google. We don't want invitation emails (deliverability, SMTP, expiring links). Each workspace
needs a way to say who may get in and with what role, managed by the workspace owner or an agency admin, without ever
giving the app the service-role key.

## Decision

- Two per-workspace lists: **allowed domains** (`workspace_domains`, a domain belongs to at most one workspace) and
  **pre-assigned emails** (`workspace_access_emails`: email → role, optional person record). Only `can_manage_workspace`
  (agency admin or owner) can read or change them, enforced by RLS.
- **Resolution** is a narrowly scoped `SECURITY DEFINER` function, `public.resolve_my_access()`, that only reconciles the
  caller (`auth.uid()`). The app calls it from `/auth/callback` after every sign-in, and again from `/` when a signed-in
  user sees no workspace. It is idempotent. Order:
  1. confirmed email on the pre-assigned list → exactly that role (`source = 'access_list'`);
  2. otherwise Google `hd` claim **and** confirmed email domain both equal an allowed domain → `member` (`source = 'domain'`);
  3. otherwise nothing → holding page.
- **Where `hd` comes from.** Supabase Auth reads Google's ID token and stores the hosted-domain claim as
  `custom_claims.hd` in both `auth.users.raw_user_meta_data` and `auth.identities.identity_data` (GoTrue
  `parseGoogleIDToken`). We read it **only from `auth.identities`**: `user_metadata` is writable by the user through
  `auth.updateUser`, so trusting it would let anyone claim a domain. Personal Google accounts (including ones created
  with a work address) have no `hd` and never join by domain. GoTrue only keeps `hd` when Google returns an ID token, so
  the login action adds the `openid` scope; without an ID token GoTrue falls back to the userinfo endpoint, drops `hd`,
  and domain join fails closed. Microsoft (later) should use the tenant ID the same way.
- **Free-mail domains** (gmail.com, outlook.com, …) are rejected by a check constraint (`is_free_mail_domain`); people
  on them go on the pre-assigned list.
- `memberships` gains `source` (`manual` | `access_list` | `domain`), `active` and `person_id`. Resolution never touches
  `manual` rows (e.g. `make-agency-admin.sql`) and never reactivates an inactive row, so "Remove access" on a domain
  member sticks. The list is authoritative for listed people's role; a domain member's promotion is kept.
- **Removal is immediate.** Triggers on the two lists re-run reconciliation for affected users, and RLS reads
  `memberships` on every request (`workspace_role()` now ignores inactive rows), so removal takes effect on the next
  request, not just the next sign-in.
- **Audit.** Triggers write every insert/update/delete on `memberships`, `workspace_domains` and
  `workspace_access_emails` to `audit_log` (PRD §5 shape; no foreign keys so entries outlive what they describe).
  Automatic joins are recorded with `actor_kind = 'system'`.
- Owners cannot grant, change or remove `agency_admin` memberships; `agency_admin` can't be pre-assigned.

## Consequences

- Google Workspace users on a *secondary* domain have `hd` = the primary domain, so they don't match a domain join for
  the secondary domain; add them by email (or we relax the rule later).
- `workspace_members(ws)` is a second `SECURITY DEFINER` function so the Access page can show emails and last sign-in
  from `auth.users`, returning nothing unless the caller manages the workspace.
- Existing sessions revoked from the list keep a valid JWT but see nothing through RLS; there is no session kill.
