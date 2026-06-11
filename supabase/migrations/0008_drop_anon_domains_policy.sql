-- ─────────────────────────────────────────────────────────────
-- 0008_drop_anon_domains_policy.sql
-- The anon select policy on public.domains used `using (true)`, which let
-- anyone holding the public anon key read every column of every customer's
-- row — verify_token, user_id, hostname, site_profile, brand_voice. RLS is
-- row-level, not column-level, so the policy exposed full rows.
--
-- No code path needs it: all public blog/embed/robots reads use the
-- service-role client (bypasses RLS), and every server-client read of
-- domains sits behind an auth guard, so it runs as `authenticated` and is
-- covered by the "own domains" policy. The browser anon client is only
-- used for login/signup and never queries this table.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "domains readable to anon for published lookup" on public.domains;
