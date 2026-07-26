-- ─────────────────────────────────────────────────────────────
-- 0028_drop_instagram_platform.sql
-- Instagram is gone: grove no longer talks to the Meta Graph API at all,
-- so there is no code path that can connect, refresh, or post one of these
-- rows. Delete the stranded connections (their tokens are now dead weight)
-- and narrow the platform check so nothing can write 'instagram' again.
--
-- Safe to re-run: the delete is a no-op once empty, and the constraint is
-- dropped-if-exists before being recreated.
-- ─────────────────────────────────────────────────────────────

delete from public.social_connections where platform = 'instagram';

alter table public.social_connections
  drop constraint if exists social_connections_platform_check;

alter table public.social_connections
  add constraint social_connections_platform_check
  check (platform in ('x', 'linkedin'));
