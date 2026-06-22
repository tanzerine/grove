-- ─────────────────────────────────────────────────────────────
-- 0013_search_console.sql
-- Google Search Console connection (read-only) + a daily snapshot of
-- per-page / per-query metrics. GSC is the loop's first REAL feedback
-- signal: impressions + position exist before you have any traffic, so
-- the strategist can stop planning blind and refresh near-winners.
--
-- The OAuth refresh token is stored encrypted (AES-256-GCM) by the app
-- layer, same as social_connections.
-- ─────────────────────────────────────────────────────────────

alter table public.domains
  add column if not exists gsc_refresh_token text,        -- AES-GCM ciphertext
  add column if not exists gsc_site_url      text,        -- 'sc-domain:host' or 'https://host/'
  add column if not exists gsc_connected_at  timestamptz,
  add column if not exists gsc_synced_at     timestamptz;

-- One trailing-window snapshot per (dimension, key) per sync day. Keeping a
-- daily snapshot (rather than one row ever) lets us show week-over-week
-- movement — "position improving / decaying" — without storing per-date rows.
create table if not exists public.gsc_metrics (
  id           uuid primary key default gen_random_uuid(),
  domain_id    uuid not null references public.domains(id) on delete cascade,
  dimension    text not null check (dimension in ('page', 'query')),
  key          text not null,                              -- page url OR query string
  post_id      uuid references public.posts(id) on delete set null,  -- resolved for dimension='page'
  date         date not null,                              -- the sync day this snapshot was taken
  clicks       int  not null default 0,
  impressions  int  not null default 0,
  position     real not null default 0,                    -- avg position over the trailing window
  unique (domain_id, dimension, key, date)
);
create index if not exists gsc_metrics_domain_date_idx on public.gsc_metrics (domain_id, date);
create index if not exists gsc_metrics_domain_dim_idx  on public.gsc_metrics (domain_id, dimension);

alter table public.gsc_metrics enable row level security;
-- owner can read their own rows; writes happen via the service role (cron/sync),
-- which bypasses RLS — same model as post_events.
create policy "own gsc metrics" on public.gsc_metrics
  for all using (
    exists (select 1 from public.domains d where d.id = gsc_metrics.domain_id and d.user_id = auth.uid())
  );
