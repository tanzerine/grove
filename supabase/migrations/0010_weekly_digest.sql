-- ─────────────────────────────────────────────────────────────
-- 0010_weekly_digest.sql
-- The retention loop: a weekly email digest of the agent's brief.
--
-- The cron (/api/cron/weekly-digest) composes the same plain-English brief
-- shown on the dashboard home and emails it to each verified domain's owner.
-- This column lets an owner opt out without unverifying or pausing the agent.
-- ─────────────────────────────────────────────────────────────

alter table public.domains
  add column if not exists weekly_digest boolean not null default true;
