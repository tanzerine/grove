-- ─────────────────────────────────────────────────────────────
-- 0007_social_connections.sql
-- OAuth connections to X / LinkedIn / Instagram, plus the flags needed
-- to auto-publish a post's social copy when the post itself publishes.
-- Tokens are stored encrypted (AES-256-GCM) by the app layer.
-- ─────────────────────────────────────────────────────────────

create table public.social_connections (
  id             uuid primary key default gen_random_uuid(),
  domain_id      uuid not null references public.domains(id) on delete cascade,
  platform       text not null check (platform in ('x', 'linkedin', 'instagram')),
  account_handle text,                 -- @handle / vanity name for display
  account_id     text,                 -- platform user/page id used when posting
  access_token   text not null,        -- AES-GCM ciphertext
  refresh_token  text,                 -- AES-GCM ciphertext (null if platform has none)
  expires_at     timestamptz,          -- when access_token expires (null = long-lived)
  scopes         text,
  connected_at   timestamptz not null default now(),
  unique (domain_id, platform)
);
create index on public.social_connections (domain_id);

alter table public.social_connections enable row level security;
create policy "own social connections" on public.social_connections
  for all using (
    exists (select 1 from public.domains d where d.id = social_connections.domain_id and d.user_id = auth.uid())
  );

-- master switch: auto-post to connected socials when a post publishes
alter table public.domains
  add column if not exists auto_social boolean not null default false;

-- per-post record of what we already pushed, so the cron never double-posts
-- shape: { "x": { "id": "...", "at": "ISO" }, "linkedin": {...} }
alter table public.posts
  add column if not exists social_published jsonb not null default '{}'::jsonb;
