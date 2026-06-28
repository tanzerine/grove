-- ─────────────────────────────────────────────────────────────
-- 0015_refund_requests.sql
-- Churn / refund funnel. A customer fills out a short exit survey and
-- requests a refund; the row lands here, the owner is emailed, and the
-- owner approves the actual Stripe refund from the admin view.
--
-- Money is NEVER moved by the customer — submitting only creates a
-- 'pending' row. Refunds are issued by an owner-approved action.
--
-- RLS: a user may READ their own requests; all writes go through the
-- service-role client (submit endpoint + owner approve endpoint), scoped
-- server-side to the authenticated user / verified admin. No client write
-- policy exists, mirroring the subscriptions hardening in 0014.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.refund_requests (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  email                    text,                    -- denormalised for the record/email
  plan                     text,                    -- plan at time of request

  -- exit survey (business insight)
  reason                   text,                    -- reason code (see lib/refunds.ts)
  feedback                 text,                    -- "what could we have done better?"
  comeback                 text,                    -- "what would bring you back?"

  -- stripe linkage (captured best-effort at submit, re-resolved at approval)
  stripe_customer_id       text,
  stripe_subscription_id   text,
  stripe_payment_intent_id text,

  -- lifecycle
  status                   text not null default 'pending',  -- pending | refunded | no_charge | failed | dismissed
  refund_id                text,                    -- Stripe refund id once issued
  amount_cents             int,
  currency                 text,
  processed_at             timestamptz,
  processed_by             text,                    -- owner email who approved

  created_at               timestamptz not null default now()
);
create index if not exists refund_requests_status_idx on public.refund_requests (status, created_at desc);
create index if not exists refund_requests_user_idx on public.refund_requests (user_id);

alter table public.refund_requests enable row level security;

-- Owner of the request can read their own rows (for in-app status). No write
-- policy → inserts/updates happen only via the service-role key.
create policy "read own refund requests" on public.refund_requests
  for select using (auth.uid() = user_id);
