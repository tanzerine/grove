-- ─────────────────────────────────────────────────────────────
-- 0035_mcp_keys.sql
-- MCP access for customers who already own a content layer.
--
-- WHO THIS IS FOR. The embed (public/embed.js) and the hosted mirror both
-- assume grove renders the article. A customer with a *thick* blog already has
-- one — MDX in a repo, Sanity/Contentful, a bespoke CMS — with their own
-- templates, their own routes and their own review flow. They don't want a
-- script tag; they want the finished article INSIDE the layer they already
-- run. MCP is how their agent (Claude Code, Cursor, an internal one) reaches
-- in and takes it.
--
-- WHY A SEPARATE CREDENTIAL. Every existing surface is authenticated one of
-- three ways: a browser session (RLS), the service-role key (crons), or a
-- shared secret (CRON_SECRET). None fits an agent running on the customer's
-- laptop or CI: it isn't a browser, it must be revocable on its own, and it
-- must be scopeable to one site and to read-only. So: per-user API keys, one
-- row each, revoked individually.
--
-- ONLY THE HASH IS STORED. The secret is shown once at creation and never
-- again — grove keeps sha256(secret) and looks the row up by that digest, so
-- a database leak cannot be replayed against the API. `key_prefix` is the
-- non-secret display half ("gv_mcp_ab12cd34…") the dashboard lists.
--
-- RLS: `mcp_keys` gets RLS with NO policy at all, exactly like beta_coupons
-- (0033) and refund_requests (0015) — service-role only. The dashboard reads
-- its own keys through the service-role client, scoped server-side to the
-- authenticated user, and selects an explicit column list that omits the hash.
-- A credential digest must never be reachable with an anon or user key.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.mcp_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- NULL = every site this user owns (the common case: one agent, one repo,
  -- all their blogs). Set = the key can only ever see that one domain, which
  -- is what an agency handing a key to one client needs.
  domain_id     uuid references public.domains(id) on delete cascade,
  name          text not null default 'Content layer',
  -- Display half. NOT unique on its own — uniqueness lives on the digest.
  key_prefix    text not null,
  -- sha256(secret) as lowercase hex. Unique so auth is a single indexed
  -- lookup: no scan, no timing comparison over candidate rows.
  key_hash      text not null unique,
  -- 'read' is always present. 'write' additionally allows the two tools that
  -- change grove state: recording where an article went live, and pointing
  -- grove's canonical at the customer's own URLs.
  scopes        text[] not null default array['read']::text[],
  expires_at    timestamptz,             -- null = no expiry
  revoked_at    timestamptz,             -- set instead of deleting: the
                                         -- delivery ledger keeps referencing it
  last_used_at  timestamptz,
  last_tool     text,                    -- newest tool name, for the dashboard
  calls         int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists mcp_keys_user_idx on public.mcp_keys (user_id, created_at desc);

comment on column public.mcp_keys.key_hash is
  'sha256(secret) hex. The secret itself is returned exactly once, by the '
  'create endpoint, and is not recoverable afterwards. Auth looks the row up '
  'by this digest (lib/mcp/keys.ts hashKey), so a dump of this table cannot be '
  'replayed against /api/mcp.';

-- ── where each article actually landed ─────────────────────────────────────
-- The customer's layer, not grove, owns the published URL now. Without this
-- table grove cannot answer the two questions the whole feature turns on:
-- "what haven't I pulled yet?" (the agent's incremental sync) and "is my
-- content actually live?" (the dashboard). One row per post, upserted, so a
-- re-delivery after an edit moves the timestamp instead of piling up.
create table if not exists public.mcp_deliveries (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid not null references public.domains(id) on delete cascade,
  post_id       uuid not null references public.posts(id) on delete cascade,
  -- Which key reported it. ON DELETE SET NULL: revoking a key must not erase
  -- the record that its content is live on the customer's site.
  key_id        uuid references public.mcp_keys(id) on delete set null,
  external_url  text,                    -- where it went live, as reported
  external_id   text,                    -- their CMS's own id, if they have one
  layer         text,                    -- free-form: 'mdx', 'sanity', 'wordpress'…
  delivered_at  timestamptz not null default now(),
  unique (post_id)
);
create index if not exists mcp_deliveries_domain_idx
  on public.mcp_deliveries (domain_id, delivered_at desc);

alter table public.mcp_keys       enable row level security;
alter table public.mcp_deliveries enable row level security;

-- mcp_keys: deliberately NO policy (see header).

-- Deliveries carry no secret and the dashboard renders them per site, so the
-- owner may read their own through the ordinary session client. Writes stay
-- service-role only — they arrive from the MCP endpoint, which has already
-- resolved the key to a user and a domain.
create policy "read own mcp deliveries" on public.mcp_deliveries
  for select using (
    exists (select 1 from public.domains d where d.id = mcp_deliveries.domain_id and d.user_id = auth.uid())
  );
