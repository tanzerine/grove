-- ─────────────────────────────────────────────────────────────
-- 0043_strategy_fallback_reason.sql
-- WHY the strategy tier did not build this plan.
--
-- 0029 added `planned_by` so that "is the strategy tier really being used?"
-- became a query instead of a code read — after the answer had silently been
-- "no" for every automated build for months. It works. It also stops one
-- question short of the one you need next: when the row says the workhorse
-- planned it, WHY?
--
-- That reason existed only as a console.error inside strategyLlmCall. A
-- fallback is not an error — a plan was produced and persisted — so nothing
-- wrote to `domains.strategy_error` either, and `strategy_error` is cleared on
-- the next success regardless. Diagnosing a fallback therefore required having
-- had Vercel log access at the moment it happened. After the fact it was
-- unknowable from the product, which is precisely the failure mode 0029 was
-- added to end.
--
-- THE CASE THAT PROMPTED IT. Two plans came back from the workhorse — one on
-- 2026-09-13, one on 2026-09-15 — at 2 slots and 1 pillar each, against an
-- Opus average of 14.5 slots and 3.6 pillars across 11 plans. A fallback plan
-- is not a degraded plan, it is a thin one, and a customer living on it has a
-- near-empty month. The timings rule out a timeout: the whole failed build
-- finished in 79.6s with ~204s offered to Opus, so it errored fast. WHICH
-- error could not be recovered, because nothing had written it down.
--
-- The column also distinguishes the two shapes that look identical on the row:
--   'skipped: budget …'  — the ladder never offered Opus enough wall clock
--                          (the 0029 bug's exact signature, still possible)
--   '<model> failed after <n>ms offered: …' — Opus ran and threw
--
-- SAFE ON ARRIVAL. A nullable column on an existing table, no backfill, no
-- change to any read. This repo has shipped a migration to production without
-- anyone running db:push (see 0029), so arriving ahead of its writer must be a
-- no-op — and it is: until ensureMonthlyStrategy writes it, every row holds
-- null and every existing behaviour is byte-identical. The writer is fail-soft
-- for the same reason, so the reverse order is equally safe: a diagnostic must
-- never cost the month's plan.
-- ─────────────────────────────────────────────────────────────

alter table public.strategies
  add column if not exists fallback_reason text;

comment on column public.strategies.fallback_reason is
  'Why the strategy tier (REPLICATE_STRATEGY_MODEL) did not produce this plan, when planned_by names the workhorse instead. Null on a clean top-tier build. Two shapes: "skipped: budget …" means the ladder never offered it enough wall clock; "<model> failed after <n>ms offered: …" means it ran and threw — the offered budget is included because a provider error and a timeout are otherwise indistinguishable after the fact.';
