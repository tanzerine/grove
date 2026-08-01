-- Planning attempts, so one unplannable domain can't starve every other one.
--
-- /api/cron/strategy builds ONE domain per hourly invocation and used to take
-- whichever unplanned domain came first by created_at. Only a SUCCESSFUL build
-- removes a domain from that queue, so a domain that failed was first again on
-- the next tick, forever — every domain behind it went unplanned, and with no
-- live plan nothing materializes, drafts, or publishes. Recording the ATTEMPT
-- (not the success) lets the queue rotate: a broken domain costs one tick per
-- rotation instead of all of them.
--
-- Both columns are nullable adds with no default, so arriving on production
-- ahead of the deploy that reads them is a no-op. The route also degrades to a
-- select without them, so an unapplied migration means "no rotation", not
-- "no plan".

alter table public.domains
  add column if not exists strategy_attempted_at timestamptz,
  add column if not exists strategy_error text;

comment on column public.domains.strategy_attempted_at is
  'When the planner last STARTED a monthly strategy build for this domain. Stamped before the LLM call so a build killed mid-flight still counts; /api/cron/strategy orders its queue by this, oldest first.';

comment on column public.domains.strategy_error is
  'Why the last strategy build failed, or null when the last one succeeded. The reason used to exist only in Vercel logs, which is how a domain failed to plan every tick for half a day unnoticed.';
