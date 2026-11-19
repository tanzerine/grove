-- ─────────────────────────────────────────────────────────────
-- 0046_meetings.sql
-- Meeting links: the owner offers call times to a prospect, the prospect picks
-- one (or suggests their own), the owner confirms. A Calendly replacement for
-- the outreach funnel, kept inside grove so the link is on our own domain.
--
-- WHY A TOKEN, NOT AN ACCOUNT. The prospect is a stranger from a DM. Asking
-- them to sign up before they can pick a time is the friction this replaces.
-- The page is private by obscurity, like /r/<slug> prospect reports: a random
-- 24-character token, never indexed, never in a sitemap.
--
-- WHY THE SERVER DECIDES EVERY TRANSITION. The public route takes a token and
-- a pick, and nothing else it says is trusted: a pick must be one of `slots`,
-- a suggestion must be in the future, and only the owner (admin session) can
-- confirm. lib/meetings.ts holds those rules as pure functions.
--
-- Safe on arrival: create-if-not-exists throughout, no change to any existing
-- table. Merging this file to main applies it (see CLAUDE.md, Supabase).
--
-- RLS: enabled with NO policy — service-role only, same shape as
-- outreach_prospects (0035). It holds a stranger's email address.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  token           text not null,                       -- the public URL key

  -- ── what the owner set up ────────────────────────────────────────────────
  prospect_name   text not null,
  prospect_org    text,                                -- company / product
  title           text not null default 'Intro call',
  duration_min    int  not null default 30 check (duration_min between 10 and 180),
  owner_tz        text not null default 'Asia/Seoul',  -- IANA zone the owner plans in
  slots           jsonb not null default '[]'::jsonb,  -- ISO UTC start times offered
  owner_note      text,                                -- shown to the prospect

  -- ── what the prospect sent back ──────────────────────────────────────────
  picked_start    timestamptz,                         -- one of slots
  proposed        jsonb not null default '[]'::jsonb,  -- their own ISO suggestions
  prospect_email  text,
  prospect_tz     text,
  prospect_note   text,
  responded_at    timestamptz,

  -- ── the outcome ──────────────────────────────────────────────────────────
  -- open: waiting on the prospect. requested: they answered, waiting on the
  -- owner. confirmed: a time is set. cancelled: dead link.
  status          text not null default 'open'
                  check (status in ('open','requested','confirmed','cancelled')),
  confirmed_start timestamptz,
  meeting_url     text,                                -- video link, added on confirm

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists meetings_token_key on public.meetings (token);
create index if not exists meetings_status_idx on public.meetings (status, updated_at desc);

alter table public.meetings enable row level security;
-- Intentionally no policy: service-role reads and writes only.

comment on table public.meetings is
  'Owner-to-prospect meeting links (/meet/<token>). Service-role only; holds prospect emails.';
