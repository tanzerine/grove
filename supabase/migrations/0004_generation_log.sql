-- Per-post pipeline log. Each entry is { ts, step, event, message? }.
-- The UI shows this as a live timeline so users see exactly what's happening
-- without checking Vercel logs.
alter table public.posts
  add column if not exists generation_log jsonb not null default '[]'::jsonb;
