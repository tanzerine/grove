-- ─────────────────────────────────────────────────────────────
-- 0005_agentic.sql
-- Strategy, manager evaluation, and analytics event tables.
-- ─────────────────────────────────────────────────────────────

-- Interview answers — owner-supplied intent that the strategist
-- agent treats as the highest-authority input each month.
alter table public.domains
  add column if not exists interview jsonb;

-- =========================================================
-- strategies — one row per (domain, month). Latest active row
-- per domain drives the topic refiner + manager evaluator.
-- =========================================================
create table public.strategies (
  id               uuid primary key default gen_random_uuid(),
  domain_id        uuid not null references public.domains(id) on delete cascade,
  month            date not null,                  -- first day of the month it covers
  source           text not null default 'inferred',-- inferred | interview | mixed
  goals            jsonb not null default '[]'::jsonb,
  kpis             jsonb not null default '[]'::jsonb,
  pillars          jsonb not null default '[]'::jsonb,
  publishing_plan  jsonb not null default '[]'::jsonb,
  interview        jsonb,                          -- raw owner answers, if any
  prev_review      jsonb,                          -- summary of last month, for audit
  notes            text,                           -- "what we're changing vs. last month"
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index on public.strategies (domain_id, month desc);
create unique index strategies_active_uq
  on public.strategies (domain_id, month)
  where active = true;

-- =========================================================
-- post_evaluations — the manager agent's review of each draft.
-- One post can have multiple eval rows (initial + post-rewrite).
-- =========================================================
create table public.post_evaluations (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  strategy_id   uuid references public.strategies(id) on delete set null,
  attempt       int  not null default 1,            -- 1 = first review, 2 = after rewrite
  action        text not null,                      -- approve | rewrite | reject
  pass          boolean not null,
  scores        jsonb not null default '{}'::jsonb, -- per-rubric numeric scores
  issues        jsonb not null default '[]'::jsonb, -- [{rule, severity, note}]
  rewrite_brief text,                               -- targeted instructions for round 2
  created_at    timestamptz not null default now()
);
create index on public.post_evaluations (post_id);
create index on public.post_evaluations (strategy_id);

-- =========================================================
-- post_events — first-party analytics, append-only.
-- Truncate IPs at ingest; we never store full IPs.
-- =========================================================
create table public.post_events (
  id            bigserial primary key,
  post_id       uuid not null references public.posts(id) on delete cascade,
  domain_id     uuid not null references public.domains(id) on delete cascade,
  type          text not null,           -- view | dwell | scroll | outbound | exit | conversion
  session_id    text not null,           -- per-tab, generated client-side
  referrer      text,
  referrer_host text,                    -- normalized (google.com, t.co, etc.)
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  query         text,                    -- ?q= or referrer search query if we can parse it
  outbound_url  text,                    -- only for outbound events
  scroll_depth  smallint,                -- 25 | 50 | 75 | 100
  dwell_ms      int,                     -- cumulative dwell at event time
  country       text,                    -- 2-letter, from CDN header if present
  ua_kind       text,                    -- bot | desktop | mobile | tablet
  ip_prefix     text,                    -- /24 for v4 or /48 for v6, hashed
  created_at    timestamptz not null default now()
);
create index on public.post_events (post_id, created_at desc);
create index on public.post_events (domain_id, type, created_at desc);
create index on public.post_events (session_id);

-- =========================================================
-- RLS
-- =========================================================
alter table public.strategies        enable row level security;
alter table public.post_evaluations  enable row level security;
alter table public.post_events       enable row level security;

create policy "own strategies" on public.strategies
  for all using (
    exists (select 1 from public.domains d where d.id = strategies.domain_id and d.user_id = auth.uid())
  );

create policy "own evaluations" on public.post_evaluations
  for all using (
    exists (
      select 1 from public.posts p join public.domains d on d.id = p.domain_id
      where p.id = post_evaluations.post_id and d.user_id = auth.uid()
    )
  );

create policy "own events read" on public.post_events
  for select using (
    exists (select 1 from public.domains d where d.id = post_events.domain_id and d.user_id = auth.uid())
  );

-- Events are inserted by the public ingest endpoint via the service role
-- key — no anon insert policy needed (and we don't want one, since that
-- would let anyone forge events).
