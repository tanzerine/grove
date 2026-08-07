-- ─────────────────────────────────────────────────────────────
-- 0034_feedback.sql
-- One inbox for everything a customer wants to tell the owner:
--
--   testimonial  — "this worked", with consent to quote it publicly
--   shortcoming  — "this fell short / this is missing"   (roadmap input)
--   complaint    — "this is wrong, I want a human"       (needs a reply)
--
-- ONE TABLE, NOT THREE. They are the same event — a customer took the trouble
-- to write to us — arriving through three doors, and the owner works them from
-- one place. Three tables would mean three queries, three notification paths
-- and three admin views to keep in step, for rows that differ by a handful of
-- nullable columns. `kind` is the discriminator; lib/feedback.ts owns the
-- vocabulary so the form, the email and the admin view can't drift apart.
--
-- This is deliberately NOT refund_requests (0015). That table is the exit
-- funnel: it is coupled to Stripe, it moves money, and it only ever hears from
-- customers on their way out. This one hears from customers who are staying —
-- especially beta users, who cost nothing to acquire and whose honest
-- shortcomings are the entire point of running a beta.
--
-- RLS mirrors refund_requests: a user may READ their own submissions; there is
-- no client write policy, so every insert and every triage update goes through
-- the service-role client, scoped server-side to a verified user / admin. The
-- landing page reads published testimonials with the service role too, rather
-- than opening an anon SELECT policy — 0008 and 0011 removed the anon policies
-- this schema used to have and that hardening stands.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.feedback (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  email            text,                       -- denormalised for the owner email/record

  kind             text not null,              -- testimonial | shortcoming | complaint
  rating           int,                         -- 1..5, how it's going overall (optional)
  headline         text,                        -- short summary / pull-quote
  body             text not null,               -- the actual message
  area             text,                        -- which part of the product (see lib/feedback)
  severity         text,                        -- blocker | major | minor (complaints)

  -- ── testimonial publication ──────────────────────────────────────────────
  -- Consent is stored per submission, not per account: someone who agrees to be
  -- quoted today has not agreed to be quoted forever, and `published` is a
  -- separate owner action so nothing reaches the marketing site automatically.
  consent_publish  boolean not null default false,
  display_name     text,                        -- how they want to be credited
  display_role     text,                        -- "Founder, Acme"
  display_url      text,                        -- their site, for the credit link
  published        boolean not null default false,

  -- ── triage ───────────────────────────────────────────────────────────────
  status           text not null default 'new', -- new | acknowledged | in_progress | resolved | wont_fix | dismissed
  owner_note       text,                        -- private, never shown to the customer
  responded_at     timestamptz,
  responded_by     text,                        -- admin email

  -- ── context, captured SERVER-SIDE at submit ──────────────────────────────
  -- Never client-supplied. The same sentence means different things from a
  -- day-old beta account with two posts and from a Growth customer six months
  -- in, and asking the customer to tell us what we already know is friction on
  -- exactly the path we least want friction.
  plan             text,
  beta_code        text,
  posts_published  int,
  page_url         text,                        -- where they opened the form

  created_at       timestamptz not null default now()
);

create index if not exists feedback_triage_idx  on public.feedback (status, created_at desc);
create index if not exists feedback_kind_idx    on public.feedback (kind, created_at desc);
create index if not exists feedback_user_idx    on public.feedback (user_id, created_at desc);
-- The landing page's read: published testimonials, newest first.
create index if not exists feedback_published_idx
  on public.feedback (published, created_at desc)
  where published = true;

alter table public.feedback enable row level security;

-- Author can read their own submissions (so the form can show "you already
-- sent this" and the reply state). No write policy → service-role only.
create policy "read own feedback" on public.feedback
  for select using (auth.uid() = user_id);
