-- ─────────────────────────────────────────────────────────────
-- 0016_gsc_daily.sql
-- Per-DAY Search Console totals, so the analytics dashboard can draw a real
-- trend curve instead of an illustrative one. gsc_metrics (0013) keeps a
-- per-(page|query) snapshot taken on the sync day; this keeps one row per
-- ACTUAL calendar day GSC reported, upserted each sync as the trailing window
-- slides forward.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.gsc_daily (
  domain_id    uuid not null references public.domains(id) on delete cascade,
  date         date not null,                  -- the calendar day GSC reported
  clicks       int  not null default 0,
  impressions  int  not null default 0,
  ctr          real not null default 0,        -- 0..1
  position     real not null default 0,        -- avg position that day
  primary key (domain_id, date)
);
create index if not exists gsc_daily_domain_date_idx on public.gsc_daily (domain_id, date);

alter table public.gsc_daily enable row level security;
-- Owner reads their own rows; writes go through the service role (cron/sync),
-- which bypasses RLS — same model as gsc_metrics / post_events.
create policy "own gsc daily" on public.gsc_daily
  for all using (
    exists (select 1 from public.domains d where d.id = gsc_daily.domain_id and d.user_id = auth.uid())
  );
