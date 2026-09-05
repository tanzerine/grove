-- ─────────────────────────────────────────────────────────────
-- 0040_oauth_site_scope.sql
-- Per-site consent: which of the customer's sites an agent may see.
--
-- Numbered against the live `supabase migration list` (0001–0039 applied),
-- not `ls supabase/migrations/`.
--
-- WHY. 0039 shipped consent as all-or-nothing: approving an agent gave it every
-- site on the account. That is the right default and the wrong only option. An
-- agency running six client blogs out of one grove account has no way to let a
-- client's own coding agent near that client's articles without handing it the
-- other five, and "make a pinned key instead" pushes them back to the
-- copy-a-secret flow this whole line of work exists to remove.
--
-- NULL MEANS EVERY SITE, deliberately — the same convention mcp_keys.domain_id
-- already uses, and the same meaning for rows written before this column
-- existed. An empty array would be a different thing entirely (an agent that
-- may see nothing), and nothing writes one: the consent screen refuses to
-- submit with no site selected.
--
-- Not a foreign key, because uuid[] cannot carry one. The consent handler
-- checks every id against the domains the signed-in user owns before storing,
-- and lib/mcp/handlers.ts scopes each query with `.in('id', …)` — a deleted
-- domain simply stops matching, which is the same outcome a cascade would give.
-- ─────────────────────────────────────────────────────────────

alter table public.oauth_codes  add column if not exists domain_ids uuid[];
alter table public.oauth_tokens add column if not exists domain_ids uuid[];

comment on column public.oauth_tokens.domain_ids is
  'Sites this grant may reach. NULL = every site the user owns (the default, '
  'and the meaning for rows written before 0040). Never an empty array: the '
  'consent screen will not submit with nothing selected.';
