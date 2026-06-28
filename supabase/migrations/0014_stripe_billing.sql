-- ─────────────────────────────────────────────────────────────
-- 0014_stripe_billing.sql
-- Wire Stripe into the existing `subscriptions` table.
--
-- Adds the Stripe linkage columns, an idempotency log for webhook
-- events, and — importantly — HARDENS RLS so a logged-in user can READ
-- their own subscription but can NEVER write to it. Entitlements (plan,
-- quota, status) are granted *only* by the signature-verified Stripe
-- webhook, which uses the service-role client and bypasses RLS. Without
-- this, the old `for all ... with check (auth.uid() = user_id)` policy
-- let any authenticated user UPDATE their own row and self-upgrade to
-- plan='agency' / posts_quota=9999. That is the security hole this closes.
-- ─────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_status          text,        -- active | past_due | canceled | unpaid | incomplete ...
  add column if not exists stripe_price_id         text,
  add column if not exists current_period_end      timestamptz,
  add column if not exists updated_at              timestamptz not null default now();

-- One Stripe customer maps to at most one subscription row (lookup key for the webhook).
create unique index if not exists subscriptions_stripe_customer_uq
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

-- ── RLS: read-only for the owner, no client writes ──
drop policy if exists "own subscription" on public.subscriptions;

create policy "read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- NOTE: deliberately NO insert/update/delete policy for authenticated users.
-- The handle_new_user() trigger (security definer) still seeds the row, and
-- the Stripe webhook writes via the service-role key (bypasses RLS).

-- ── Idempotency log: each Stripe event id is processed at most once ──
create table if not exists public.stripe_events (
  id           text primary key,            -- Stripe event id (evt_…)
  type         text not null,
  received_at  timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- No policies → only the service-role client (webhook) can touch it.
