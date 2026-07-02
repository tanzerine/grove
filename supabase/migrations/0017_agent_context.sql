-- ─────────────────────────────────────────────────────────────
-- 0017_agent_context.sql
-- The agent's working memory (compact markdown, per domain) and
-- the plan-revision chat that lets owners steer it.
-- ─────────────────────────────────────────────────────────────

-- The strategist now emits an owner-facing narrative: one line for the month,
-- one per week ({ month: text, weeks: text[] }). Drives the dashboard's
-- "this month / this week / today" answer.
alter table public.strategies
  add column if not exists direction jsonb;

-- =========================================================
-- agent_context — one row per domain. Two small markdown docs:
--   plan_md     — the active plan rendered as a compact memo
--                 (month goal, weekly direction, slots). Rebuilt
--                 whenever a strategy is created or revised.
--   progress_md — a rolling weekly log (appended by the Monday
--                 cron, trimmed to a fixed number of entries so
--                 prompt cost stays flat as months accumulate).
-- Every LLM step in the loop reads these instead of re-serializing
-- full strategy/report JSON — that's the token-efficiency contract.
-- =========================================================
create table public.agent_context (
  domain_id    uuid primary key references public.domains(id) on delete cascade,
  plan_md      text not null default '',
  progress_md  text not null default '',
  updated_at   timestamptz not null default now()
);

-- =========================================================
-- plan_chat_messages — the owner ↔ strategist conversation.
-- Kept as a table (not jsonb) so monthly budget caps are one
-- count query. `revised = true` on an agent row means that turn
-- committed a strategy revision (the expensive path).
-- =========================================================
create table public.plan_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  domain_id    uuid not null references public.domains(id) on delete cascade,
  strategy_id  uuid references public.strategies(id) on delete set null,
  role         text not null check (role in ('user', 'agent')),
  content      text not null,
  revised      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on public.plan_chat_messages (domain_id, created_at desc);

-- =========================================================
-- RLS — owners read their own rows; all writes go through the
-- service role in API routes (so budget caps can't be bypassed).
-- =========================================================
alter table public.agent_context      enable row level security;
alter table public.plan_chat_messages enable row level security;

create policy "own agent context read" on public.agent_context
  for select using (
    exists (select 1 from public.domains d where d.id = agent_context.domain_id and d.user_id = auth.uid())
  );

create policy "own plan chat read" on public.plan_chat_messages
  for select using (
    exists (select 1 from public.domains d where d.id = plan_chat_messages.domain_id and d.user_id = auth.uid())
  );
