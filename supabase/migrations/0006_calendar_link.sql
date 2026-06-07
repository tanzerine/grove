-- ─────────────────────────────────────────────────────────────
-- 0006_calendar_link.sql
-- Link posts back to the strategy slot they fulfill, so the calendar
-- can show "what is being published, when" and trace every post to the
-- plan that produced it. Slots themselves gain a `publish_date` inside
-- strategies.publishing_plan (JSON — no DDL needed for that).
-- ─────────────────────────────────────────────────────────────

alter table public.posts
  add column if not exists strategy_id uuid references public.strategies(id) on delete set null,
  add column if not exists slot_id     text;   -- PostSlot.id within strategy.publishing_plan

-- one post per plan slot — lets the materializer dedupe with an upsert-style guard
create unique index if not exists posts_strategy_slot_uq
  on public.posts (strategy_id, slot_id)
  where strategy_id is not null and slot_id is not null;

create index if not exists posts_strategy_idx on public.posts (strategy_id);
