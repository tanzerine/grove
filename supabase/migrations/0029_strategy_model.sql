-- ─────────────────────────────────────────────────────────────
-- 0029_strategy_model.sql
-- Record WHICH model produced each monthly plan.
--
-- Strategy is the highest-leverage LLM step in the product — a bad plan wastes
-- a whole month of generation spend — and lib/llm routes it to a top-tier model
-- for exactly that reason. But nothing recorded which model actually ran, so
-- when a budget-threshold bug silently sent 100% of automated builds to the
-- cheap workhorse instead, there was no way to notice: the only evidence was a
-- console.error, and answering "is the strategist actually being used?"
-- required reading source.
--
-- One column makes it a query.
-- ─────────────────────────────────────────────────────────────

alter table public.strategies
  add column if not exists planned_by text;

comment on column public.strategies.planned_by is
  'Replicate model id that produced this plan (e.g. anthropic/claude-opus-4.7). '
  'Null for plans built before this column existed. A workhorse model here on a '
  'cron-built plan means the strategy tier fell back — check the budget passed '
  'to strategyLlmCall.';
