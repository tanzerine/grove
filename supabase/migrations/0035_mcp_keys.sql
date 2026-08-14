-- ─────────────────────────────────────────────────────────────
-- 0035_mcp_keys.sql
-- API keys for grove's MCP server (/api/mcp).
--
-- WHO THIS IS FOR. A customer with a THICK content layer — their own /blog
-- route, their own card components, their own MDX pipeline — cannot use
-- embed.js: the embed renders grove's markup, and they already have markup.
-- Their integration is "pull the article into MY layer", and until now the
-- only way to do it was to hand-write a client against /api/embed/host/... the
-- way ovenai did. The MCP server turns that into something their coding agent
-- does: list what's published, fetch it in the shape their layer wants, write
-- the files, and tell grove which URLs the articles now live at.
--
-- WHY A KEY AT ALL, when the embed API is public and CORS-open. Two reasons,
-- and neither is "the content is secret":
--   1. The embed API is keyed by HOSTNAME, which is only knowable from a
--      browser on the customer's own site. An agent running in a repo has no
--      hostname to introduce itself with — the key IS the introduction, and it
--      resolves to exactly one domain row with no guessing.
--   2. One MCP tool WRITES (set_article_base flips canonical_blog_base, and
--      with it every canonical/sitemap/RSS/JSON-LD/social URL grove emits).
--      A public endpoint can never own that.
--
-- WHAT IS STORED. Only the SHA-256 of the token, never the token: a leaked
-- database row cannot be replayed as a key, and the dashboard shows the secret
-- exactly once, at mint time. `token_prefix` is the display stub
-- (grove_mcp_ab12cd…) so an owner can tell two keys apart before revoking one.
-- Lookup is by hash, so authentication is a single indexed equality — there is
-- no candidate set to compare against and therefore no timing side channel.
--
-- RLS: owners may READ and REVOKE their own keys through the session client.
-- Minting is service-role only (the route hashes and inserts) because the
-- INSERT is what decides token_hash — a client that could write that column
-- could mint itself a key for someone else's domain. Same shape as
-- beta_redemptions (0033): user-readable audit, service-role writes.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.mcp_keys (
  id            uuid primary key default gen_random_uuid(),
  -- A key is scoped to ONE domain, not to an account. A customer with three
  -- sites points three repos at grove and each key can only ever see, and only
  -- ever re-point, its own blog — so a key pasted into the wrong repo fails
  -- loudly instead of quietly syncing the wrong site's articles.
  domain_id     uuid not null references public.domains(id) on delete cascade,
  -- Denormalised from domains.user_id so ownership survives in RLS without a
  -- join, and so revoking a user's access never depends on the domain row.
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'Content layer',
  token_hash    text not null unique,
  token_prefix  text not null,
  -- Last successful authenticated call. The dashboard shows it so an owner can
  -- answer "is this key still in use?" before revoking it.
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists mcp_keys_domain_idx on public.mcp_keys (domain_id);
create index if not exists mcp_keys_user_idx on public.mcp_keys (user_id);

alter table public.mcp_keys enable row level security;

-- Read your own keys (hash included — a hash cannot be presented as a token,
-- since authentication hashes what it is given and compares to this column).
drop policy if exists "mcp_keys_select_own" on public.mcp_keys;
create policy "mcp_keys_select_own" on public.mcp_keys
  for select using (auth.uid() = user_id);

-- Revoke your own keys. UPDATE only — there is deliberately no INSERT policy
-- (minting is service-role) and no DELETE policy (revoked_at keeps the audit
-- row, so "this key was live between X and Y" stays answerable).
drop policy if exists "mcp_keys_update_own" on public.mcp_keys;
create policy "mcp_keys_update_own" on public.mcp_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.mcp_keys is
  'Per-domain API keys for the MCP server at /api/mcp, used by a customer''s coding agent to pull grove articles into their own content layer. Stores the SHA-256 of the token only; the secret is shown once at mint time.';
comment on column public.mcp_keys.token_hash is
  'SHA-256 (hex) of the presented token. Authentication hashes the bearer token and looks it up here, so this column is not itself a credential.';
comment on column public.mcp_keys.revoked_at is
  'Set instead of deleting the row: an owner asking "was this key live last Tuesday" still has an answer. Any non-null value fails authentication.';
