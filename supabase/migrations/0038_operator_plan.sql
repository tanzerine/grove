-- ─────────────────────────────────────────────────────────────
-- 0038_operator_plan.sql
-- The operator's own planner: month goals, week focus, day tasks.
--
-- WHAT THIS IS NOT. It is not the publishing calendar (`posts.scheduled_for`,
-- /dashboard/calendar) and it is not the content strategy (`strategies`).
-- Those two plan what the PRODUCT does for a customer. This plans what the
-- PERSON RUNNING THE SERVICE does — ship the migration, answer the beta
-- testers, chase the Vercel bill. Nothing here is ever shown to a customer and
-- nothing in the agent loop reads it.
--
-- WHY ONE TABLE FOR THREE HORIZONS. A month goal, a week focus and a day task
-- are the same shape — a line of text with a state — differing only in the
-- span they belong to. Three tables would triple the CRUD to express that one
-- difference. `horizon` + `period_key` carries it instead, and the key is a
-- civil string (`2026-09`, `2026-W36`, `2026-09-04`) rather than a date range
-- so that "everything in this week" is an equality, not an overlap query.
--
-- WHY period_key IS TEXT AND NOT A DATE. A week is not a date and a month is
-- not a date; storing either as one forces every reader to re-derive the span
-- and invites two readers to derive it differently. lib/operator-plan.ts is
-- the single place that builds and parses these keys, and the API validates
-- the shape on the way in — a malformed key would create a row that lands in
-- no period and can never be seen again.
--
-- WHY parent_id IS `on delete set null` AND NOT `cascade`. The link is what
-- makes this a planner rather than three unrelated lists: Tuesday's task hangs
-- off this week's focus, which hangs off the month's goal. But dropping a goal
-- you have given up on must not silently delete the week of finished work done
-- under it — that work still happened, and the record of it is the point.
--
-- RLS: enabled with NO policy, so service-role only — same shape as
-- beta_coupons (0033), outreach_prospects (0035) and mcp_keys (0036). Access
-- is gated by the `isAdminEmail` check on every route that touches it. There
-- is deliberately no user_id: the admin area has one operator, and a private
-- notebook per admin is a different (and so far unwanted) feature.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.operator_plan_items (
  id          uuid primary key default gen_random_uuid(),

  -- Which horizon the line lives at, and the span it belongs to.
  horizon     text not null check (horizon in ('month','week','day')),
  -- '2026-09' | '2026-W36' | '2026-09-04'. ISO week, so a week never straddles
  -- two keys ambiguously and the year boundary has one right answer.
  period_key  text not null,

  title       text not null,
  notes       text,

  -- `dropped` is kept distinct from a delete on purpose: "I decided not to"
  -- is a different month-end reading than "this never existed".
  status      text not null default 'todo'
              check (status in ('todo','doing','done','dropped')),

  -- The roll-up link. A day task points at a week focus; a week focus points
  -- at a month goal. Optional — plenty of days are just a list.
  parent_id   uuid references public.operator_plan_items(id) on delete set null,

  -- Manual priority within a period. Rewritten as a dense 0..n-1 sequence
  -- whenever the owner reorders a column, so ties are impossible.
  sort        int not null default 0,

  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The only read the UI ever makes: one horizon, one period, in display order.
create index if not exists operator_plan_period_idx
  on public.operator_plan_items (horizon, period_key, sort, created_at);

-- Carry-over: unfinished day tasks left behind in earlier periods.
create index if not exists operator_plan_open_idx
  on public.operator_plan_items (horizon, status, period_key);

-- Roll-up: everything hanging off one goal.
create index if not exists operator_plan_parent_idx
  on public.operator_plan_items (parent_id)
  where parent_id is not null;

alter table public.operator_plan_items enable row level security;
-- Intentionally no policy: service-role reads and writes only.

comment on table public.operator_plan_items is
  'Operator''s month/week/day planner for running the service. Admin-only, service-role only. Not the publishing calendar and not the content strategy.';
