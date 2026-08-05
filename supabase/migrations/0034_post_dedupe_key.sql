-- ─────────────────────────────────────────────────────────────
-- 0034_post_dedupe_key.sql
-- Job-level idempotency for draft creation.
--
-- POST /api/posts inserted a fresh row on every request, so a double-click, a
-- retried fetch, or two open tabs bought two posts: two quota reservations and
-- two full LLM pipelines for one intent. The only guard was `disabled={...}`
-- in the React button — a guard on the REQUEST, which is exactly the thing that
-- does not survive a retry.
--
-- The key is derived server-side from (user, domain, normalised topic, time
-- bucket) in lib/dedupe.ts, so it protects curl and a retried fetch just as
-- well as the button. The unique index is what actually enforces it: the
-- read-then-insert in the route narrows the race, this closes it, because two
-- concurrent inserts cannot both win a unique constraint.
--
-- PARTIAL index, on purpose. Every row that predates this migration — and every
-- row created by a path that does not dedupe (pSEO batches, the scheduler's own
-- drain, manual drafts) — carries NULL, and Postgres does not consider NULLs
-- equal under a plain unique index anyway. Being explicit documents the intent
-- and keeps the index to just the rows that use it.
-- ─────────────────────────────────────────────────────────────

alter table public.posts
  add column if not exists dedupe_key text;

comment on column public.posts.dedupe_key is
  'Idempotency key for draft creation, derived server-side from user + domain '
  '+ normalised topic + time bucket (lib/dedupe.ts). NULL for rows created by '
  'paths that do not dedupe. A repeat request inside the window collides on '
  'posts_dedupe_key_uniq and is collapsed onto the first post.';

create unique index if not exists posts_dedupe_key_uniq
  on public.posts (dedupe_key)
  where dedupe_key is not null;
