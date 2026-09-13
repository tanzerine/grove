-- ─────────────────────────────────────────────────────────────
-- 0042_strategy_customer_profile.sql
-- The customer profile a plan was built for (lib/strategy/icp.ts).
--
-- Step 2 of the keyword strategy infers WHO the reader is — segments, the
-- jobs they are trying to get done, what hurts, what makes them start
-- searching, and their own words for the problem — and step 3 seeds the
-- keyword research from that vocabulary. Until now the profile lived only
-- inside the build: computed, fed to the prompt, and gone. The dashboard's
-- "how your plan is built" tracker draws step 2 from this column, so the
-- owner sees the same reader the strategist planned for — not a second,
-- re-inferred one that could disagree with the plan under it.
--
-- One profile per strategy row rather than per domain, because it is an
-- input to THAT plan: a revision carries it forward, a rebuild re-infers it,
-- and the two can legitimately differ as the site profile changes.
--
-- SAFE ON ARRIVAL. Nullable, no default, no backfill; the writers in
-- lib/strategy/ensure.ts and apply-revision.ts set it in a separate,
-- fail-soft update after the row insert, so this migration landing late (or
-- early — see 0029) changes nothing about whether a plan is stored.
-- ─────────────────────────────────────────────────────────────

alter table public.strategies
  add column if not exists customer_profile jsonb;

comment on column public.strategies.customer_profile is
  'The inferred customer profile this plan was built for (lib/strategy/icp.ts CustomerProfile: segments, jobs, pains, triggers, vocabulary, objections). Null for plans built before it was inferred or when inference failed and the plan fell back to the site profile.';
