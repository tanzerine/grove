-- 0019_reads_from_events.sql
-- Recompute posts.reads from real first-party view events.
--
-- Until now `reads` was incremented on every SERVER render of an article — the
-- grove-hosted page (app/b/[slug]/[post]) and the embed article API
-- (app/api/embed/.../article/[slug]). Those fire for search-engine crawlers,
-- headless scrapers spoofing a browser UA, uptime monitors, and Next.js RSC/SSR
-- prefetches — none of which are readers. Result: dashboard "Views" ran several
-- times the real human count (e.g. 98 "views" for a post ~7 people actually read).
--
-- Going forward, reads is written only by the client 'view' beacon, deduped to
-- one per (post, session). post_events view rows are already bot-filtered (bots
-- don't run the beacon), so recomputing reads as the number of distinct view
-- sessions retroactively corrects history to match the honest going-forward count.
--
-- Idempotent: safe to re-run.

update public.posts p
set reads = coalesce(v.n, 0)
from (
  select p2.id,
         (select count(distinct e.session_id)
            from public.post_events e
           where e.post_id = p2.id
             and e.type = 'view') as n
  from public.posts p2
) v
where v.id = p.id
  and p.reads is distinct from coalesce(v.n, 0);
