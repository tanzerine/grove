-- ─────────────────────────────────────────────────────────────
-- 0011_drop_anon_posts_policy.sql
-- The anon select policy on public.posts (`using (status = 'published')`) let
-- anyone holding the public anon key read EVERY column of EVERY customer's
-- published posts — including the internal `research`, `validation`, and draft
-- `social` JSON. RLS is row-level, not column-level, so a published row exposed
-- all of its columns. The anon key ships in the client bundle, so this was
-- effectively public.
--
-- No code path needs it: every public blog / embed / RSS / sitemap read uses
-- the service-role admin client (which bypasses RLS), and the browser anon
-- client is only ever used for login/signup — it never queries `posts`. This is
-- the same class of over-exposure that 0008 removed from `domains`.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "published posts are public" on public.posts;
