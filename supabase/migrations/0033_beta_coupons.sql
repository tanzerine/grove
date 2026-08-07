-- ─────────────────────────────────────────────────────────────
-- 0033_beta_coupons.sql
-- Free beta access, granted by a coupon code, for the beta launch.
--
-- WHY NOT `comped` (0030). Comped means "not metered at all": no post quota,
-- no domain ceiling, no expiry. That is correct for the founder's own account
-- and for a bespoke deal, and wrong for a public beta code — platform capacity
-- is ticks/day x posts/tick (~720 posts/month TOTAL, see lib/pipeline/capacity),
-- so a handful of unmetered strangers can consume everything every paying
-- customer was sold. A beta grant is therefore BOUNDED on both axes: it expires
-- (`days`) and it is metered (`posts_quota`).
--
-- WHY IT LIVES ON `subscriptions` TOO. Entitlement and quota are read on hot
-- paths (entitledUserSet, quotaForUsers) that already select the subscription
-- row and nothing else. Denormalising the grant onto that row keeps those reads
-- single-table; `beta_redemptions` stays as the audit record (who redeemed
-- what, when) and is never consulted to answer "may this account generate".
--
-- Like `comped`, the grant columns are NEVER written by the Stripe webhook, so
-- a renewal or plan change can't clobber them. And unlike `comped`, the readers
-- let a live paid subscription take precedence — someone who upgrades mid-beta
-- gets the plan they paid for, not whichever number is larger.
--
-- RLS: `beta_coupons` gets RLS with NO policy at all, so it is service-role
-- only — a customer must never be able to enumerate unredeemed codes. Users may
-- read their own redemption; all writes go through the service-role client in
-- the redeem endpoint, scoped server-side to the authenticated user. Same shape
-- as refund_requests (0015).
-- ─────────────────────────────────────────────────────────────

-- ── the codes the owner hands out ──────────────────────────────────────────
create table if not exists public.beta_coupons (
  id               uuid primary key default gen_random_uuid(),
  -- Stored NORMALISED (upper case, no spaces or dashes) so "grove-beta",
  -- "GROVE BETA" and "GroveBeta" are one coupon and not three. lib/beta.ts
  -- normalizeCode() is the single implementation; the API normalises before
  -- both lookup and insert.
  code             text not null unique,
  label            text,                       -- campaign name, owner-facing only
  posts_quota      int  not null default 12,   -- posts/month while the grant is live
  days             int  not null default 30,   -- how long the grant lasts, from redemption
  max_redemptions  int,                        -- null = unlimited
  redeemed_count   int  not null default 0,
  expires_at       timestamptz,                -- the CODE stops working (null = never)
  active           boolean not null default true,
  note             text,                       -- why this code exists
  created_by       text,                       -- admin email
  created_at       timestamptz not null default now()
);

-- ── who redeemed what (audit + funnel analytics) ───────────────────────────
create table if not exists public.beta_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.beta_coupons(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  code        text not null,          -- denormalised: survives the coupon being renamed
  posts_quota int  not null,          -- what this redemption actually granted…
  expires_at  timestamptz not null,   -- …and until when, even if the coupon changes later
  email       text,
  created_at  timestamptz not null default now(),
  -- One free run per account, ever. Without this a customer whose beta lapses
  -- redeems the next code and never pays; with it, the second attempt is a
  -- clean "you've already had a beta" and an upgrade prompt.
  unique (user_id)
);
create index if not exists beta_redemptions_coupon_idx on public.beta_redemptions (coupon_id, created_at desc);

alter table public.beta_coupons     enable row level security;
alter table public.beta_redemptions enable row level security;

-- beta_coupons: deliberately NO policy. Service-role only — the codes are the
-- product being given away, so nothing reachable with an anon/user key may list
-- them. The redeem endpoint looks a code up by exact value, server-side.

-- A user may see their own redemption (for the "N days left" pill). No write
-- policy → inserts happen only via the service-role key.
create policy "read own beta redemption" on public.beta_redemptions
  for select using (auth.uid() = user_id);

-- ── the grant itself, denormalised onto the subscription ───────────────────
alter table public.subscriptions
  add column if not exists beta_code        text,
  add column if not exists beta_expires_at  timestamptz,
  add column if not exists beta_posts_quota int;

comment on column public.subscriptions.beta_expires_at is
  'End of a free beta grant (migration 0033). While in the future AND no live '
  'Stripe subscription exists, the account may generate and is metered against '
  'beta_posts_quota instead of the plan catalogue. Never written by the Stripe '
  'webhook, so renewals and plan changes cannot clobber it. Expiry is passive: '
  'nothing is deleted, the account simply stops being entitled and sees the '
  'upgrade prompt.';

create index if not exists subscriptions_beta_expiry_idx
  on public.subscriptions (beta_expires_at)
  where beta_expires_at is not null;
