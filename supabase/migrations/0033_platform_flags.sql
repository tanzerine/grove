-- ─────────────────────────────────────────────────────────────
-- 0033_platform_flags.sql
-- Platform-wide operational switches. Today: one, the generation kill switch.
--
-- WHY A TABLE AND NOT AN ENV VAR. The requirement is "halt all generation
-- without a redeploy", and on Vercel an environment variable cannot do that —
-- changing one only takes effect on the next deployment, so the lever you reach
-- for at 3am is exactly the lever that needs a build to land. A row does take
-- effect immediately: every entry point reads it per request, the drain reads
-- it per post.
--
-- lib/kill-switch.ts still honours GROVE_GENERATION_PAUSED as a second,
-- independent lever. That one survives the database being unreachable, at the
-- cost of the redeploy. Two levers, opposite failure modes, on purpose.
--
-- Written only by the service role. RLS is enabled with NO policies, so the
-- anon/authenticated keys get nothing — same posture as rate_hits (0012) and
-- stripe_events (0014). A customer must not be able to read platform state,
-- and most certainly must not be able to pause the platform.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.platform_flags (
  key        text primary key,
  enabled    boolean not null default false,
  note       text,
  updated_at timestamptz not null default now()
);

comment on table public.platform_flags is
  'Platform-wide operational switches, read at request time so a change takes '
  'effect without a redeploy. Service-role only (RLS on, no policies).';

comment on column public.platform_flags.enabled is
  'True = the switch is ENGAGED. For generation_paused that means all '
  'cost-bearing generation is halted.';

comment on column public.platform_flags.note is
  'Free text shown to operators and returned in the 503 body — say why it was '
  'paused and who to ask, so the next person does not have to guess.';

-- Seed the switch in the OFF position. Seeding it now rather than letting the
-- reader treat "no row" as off means the row is already there to flip when it
-- is needed — under pressure, an UPDATE that matches zero rows looks exactly
-- like a successful pause and is the worst possible thing to discover next.
insert into public.platform_flags (key, enabled, note)
values ('generation_paused', false, null)
on conflict (key) do nothing;

alter table public.platform_flags enable row level security;
