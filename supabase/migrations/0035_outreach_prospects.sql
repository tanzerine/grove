-- ─────────────────────────────────────────────────────────────
-- 0035_outreach_prospects.sql
-- Reddit beta-tester outreach: who we found, and who we already wrote to.
--
-- WHY THIS TABLE EXISTS AT ALL. The screening itself is stateless — run the
-- queries, score the posts, throw them away. The one thing that CANNOT be
-- recomputed is "I already DMed this person", and getting that wrong is the
-- expensive failure: a second unsolicited pitch to someone who ignored the
-- first is spam by any definition, gets the account suspended, and costs the
-- product a reputation before it has users. `author` is therefore the dedupe
-- key the scan checks against, and the unique index on it is the guarantee.
--
-- WHY UNIQUE ON `author` AND NOT ON `post_id`. The same person posts more than
-- once. Deduping on the post would happily surface u/foo's Tuesday post after
-- we DMed them about Monday's. The row keeps the post that first qualified them
-- as evidence; a later, better post is not a reason to write again.
--
-- WHAT IS NOT HERE. No message send path, no OAuth token, no Reddit
-- credentials. Drafts are copied out by a human. Nothing in this schema can
-- contact anyone.
--
-- RLS: enabled with NO policy, so this is service-role only — same shape as
-- beta_coupons (0033). It holds third-party usernames and unsent private
-- messages, and no customer has any business reading either.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.outreach_prospects (
  id           uuid primary key default gen_random_uuid(),

  -- ── who and where ────────────────────────────────────────────────────────
  source       text not null default 'reddit',   -- room for HN/X later
  author       text not null,                    -- username, no u/ prefix
  subreddit    text,
  post_id      text,                             -- reddit base-36 id, no t3_
  post_url     text,
  post_title   text,
  posted_at    timestamptz,

  -- ── what the screen decided ──────────────────────────────────────────────
  fit          int  not null default 0,          -- 0-100, lib/outreach/screen
  tier         text not null default 'skip',     -- strong | worth_a_look | skip
  pain         text,                             -- the angle the DM leads with
  -- The author's own sentences that produced the score. Kept so a verdict can
  -- be argued with months later without re-fetching a post that may be gone.
  evidence     jsonb not null default '[]'::jsonb,
  blockers     jsonb not null default '[]'::jsonb,

  -- ── the draft ────────────────────────────────────────────────────────────
  dm_subject   text,
  dm_body      text,
  -- Whether the opener came from the model or the deterministic composer.
  personalized boolean not null default false,

  -- ── the funnel ───────────────────────────────────────────────────────────
  -- new: found, not yet acted on. skipped: read and rejected, never show again.
  -- contacted: a human sent it. replied/joined: it worked.
  status       text not null default 'new'
               check (status in ('new','skipped','contacted','replied','joined')),
  coupon_code  text,                             -- which code we offered them
  contacted_at timestamptz,
  note         text,                             -- owner's own scribble

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The dedupe guarantee. Case-insensitive because Reddit usernames are
-- displayed inconsistently and "u/Foo" and "u/foo" are one person.
create unique index if not exists outreach_prospects_author_key
  on public.outreach_prospects (source, lower(author));

-- The admin list's default ordering: best unactioned prospects first.
create index if not exists outreach_prospects_triage_idx
  on public.outreach_prospects (status, fit desc, created_at desc);

alter table public.outreach_prospects enable row level security;
-- Intentionally no policy: service-role reads and writes only.

comment on table public.outreach_prospects is
  'Reddit beta outreach: screened prospects and their DM drafts. Service-role only. Unique on (source, lower(author)) so nobody is pitched twice.';
