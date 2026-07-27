-- ─────────────────────────────────────────────────────────────
-- 0030_comped_accounts.sql
-- Accounts that are not metered: internal, dogfooding, comped deals.
--
-- Grove's own domain runs on the founder's subscription, which also owns the
-- real customer site. Both therefore shared one Starter allowance (12
-- posts/month), so dogfooding directly starved the site with actual readers.
--
-- The obvious workaround — raise posts_quota by hand — does not survive. The
-- Stripe webhook rewrites posts_quota from the plan catalogue on EVERY
-- subscription event (app/api/stripe/webhook applySubscription), and this
-- subscription renews monthly, so a hand-edited quota silently reverts within
-- days and nobody notices until posts stop.
--
-- So the override has to be orthogonal to anything Stripe owns. `comped` is
-- never written by the webhook; the readers check it BEFORE they look at
-- posts_quota, which means the webhook can keep quota faithfully in sync with
-- billing (correct — that IS the billing truth) while a comped account simply
-- isn't metered against it.
-- ─────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists comped boolean not null default false;

comment on column public.subscriptions.comped is
  'Not metered: no post quota, no domain ceiling, generation allowed even if '
  'the Stripe subscription lapses. For internal/dogfooding/comped accounts. '
  'Deliberately never written by the Stripe webhook, so it survives renewals '
  'and plan changes. Platform capacity (ticks/day x posts/tick) is still the '
  'hard ceiling — this removes the billing limit, not the physical one.';
