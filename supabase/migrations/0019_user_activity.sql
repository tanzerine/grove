-- ─────────────────────────────────────────────────────────────
-- 0019_user_activity.sql
-- First-party, privacy-light usage tracking for Grove's OWN customers (the
-- dashboard), powering the admin "Users" page: retention cohorts, time spent
-- in-app, last-seen, DAU/WAU/MAU. One compact row per user per UTC day —
-- no per-event stream, no IPs, no UA strings.
--
-- Written only by the service-role client via the authenticated /api/activity
-- heartbeat (the route verifies the Supabase session, then calls
-- bump_user_activity as service role). RLS is enabled with NO policies, so
-- anon/authenticated keys read and write nothing.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.user_activity (
  user_id   uuid not null references auth.users(id) on delete cascade,
  day       date not null,
  seconds   integer not null default 0,   -- accumulated visible time in-app
  pageviews integer not null default 0,   -- dashboard route changes
  last_seen timestamptz not null default now(),
  last_path text,                          -- most recent dashboard path
  primary key (user_id, day)
);

create index if not exists user_activity_day on public.user_activity (day desc);

alter table public.user_activity enable row level security;

-- Atomic upsert-and-increment for one heartbeat. Seconds are clamped here as
-- well as in the API route so a forged beat can't inflate time by more than
-- one interval. Plain invoker rights: only the service role (which bypasses
-- RLS) can meaningfully execute it, and we revoke everyone else anyway.
create or replace function public.bump_user_activity(
  p_user uuid,
  p_seconds integer,
  p_pageview boolean,
  p_path text
) returns void
language sql
set search_path = public
as $$
  insert into public.user_activity as ua (user_id, day, seconds, pageviews, last_seen, last_path)
  values (
    p_user,
    (now() at time zone 'utc')::date,
    greatest(0, least(coalesce(p_seconds, 0), 120)),
    case when p_pageview then 1 else 0 end,
    now(),
    left(p_path, 200)
  )
  on conflict (user_id, day) do update set
    seconds   = ua.seconds + greatest(0, least(coalesce(p_seconds, 0), 120)),
    pageviews = ua.pageviews + case when p_pageview then 1 else 0 end,
    last_seen = now(),
    last_path = coalesce(left(p_path, 200), ua.last_path);
$$;

revoke execute on function public.bump_user_activity(uuid, integer, boolean, text) from public, anon, authenticated;
