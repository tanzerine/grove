-- ─────────────────────────────────────────────────────────────
-- 0012_rate_hits.sql
-- Backing store for the app-layer rate limiter (lib/ratelimit.ts), which gates
-- the cost-bearing AI endpoints (generation, image, crawl, single-LLM calls)
-- against scripted abuse / denial-of-wallet. One row per allowed hit; the
-- limiter counts rows per `bucket` within a trailing window.
--
-- Written only by the service-role client. RLS is enabled with NO policies, so
-- the anon/authenticated keys get nothing (service role bypasses RLS). Old rows
-- are pruned opportunistically by the hourly scheduler cron.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.rate_hits (
  id         bigserial primary key,
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_hits_bucket_time
  on public.rate_hits (bucket, created_at desc);

alter table public.rate_hits enable row level security;
