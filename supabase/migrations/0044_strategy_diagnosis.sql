-- The diagnosis each monthly plan was built to answer (lib/strategy/diagnosis.ts):
-- { kind, headline, metric: { name, value } }. The next month's build reads it
-- back and checks whether that metric moved, which is how the loop finds out
-- that last month's answer did not work. Nullable and written in a separate,
-- fail-soft update after the insert, so the code tolerates this column being
-- absent until the migration lands.
alter table public.strategies
  add column if not exists diagnosis jsonb;

comment on column public.strategies.diagnosis is
  'The primary diagnosis this plan answers: {kind, headline, metric:{name,value}}. Read by the next build to judge whether the metric moved.';
