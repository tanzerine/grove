-- Groundwork for refreshing near-winners in place: know WHICH queries a page
-- ranks for, and be able to tell a crawler the page changed.
--
-- Both gaps block the same job. lib/search-console/insights.ts nearWinners()
-- already finds pages stuck at positions 8-20, and lib/pipeline/generate.ts
-- already rewrites a live article in place (GenerateOptions.keepLive) without
-- moving its URL. What's missing sits underneath both:
--
--   1. gsc_metrics stores 'page' rows and 'query' rows from two SEPARATE
--      Search Console calls, so a query row carries post_id = null. We know
--      "this page is at position 12" and "we rank for 'x' at position 9" but
--      never which queries belong to which page — and a rewrite that doesn't
--      know its target query is a reroll, not a refresh.
--
--   2. posts carry no updated timestamp, so sitemap lastmod and the
--      BlogPosting dateModified both fall back to published_at (see lib/seo.ts).
--      An article rewritten in place is invisible to crawlers and to answer
--      engines: nothing on any public surface says it changed.
--
-- Safe on arrival ahead of the deploy that reads it (this repo has shipped a
-- migration to production without anyone running db:push). posts.updated_at is
-- a nullable add with no default and no backfill, so every existing row keeps
-- its exact current behaviour: readers use `updated_at ?? published_at`, and
-- null means "never refreshed". gsc_page_queries is a new table nothing writes
-- to until the sync change lands.

alter table public.posts
  add column if not exists updated_at timestamptz;

comment on column public.posts.updated_at is
  'When the article body was last rewritten in place (a near-winner refresh), or null if it never has been. Distinct from published_at, which must keep pointing at first publication: sitemap lastmod and BlogPosting dateModified read `updated_at ?? published_at`, so a null here is indistinguishable from the pre-refresh behaviour.';

-- Per (page, query) Search Console rows — the join gsc_metrics cannot express.
-- Same trailing-28-day window and same "snapshot under the sync day" convention
-- as gsc_metrics (0013), so the two are directly comparable.
create table if not exists public.gsc_page_queries (
  domain_id    uuid not null references public.domains(id) on delete cascade,
  post_id      uuid references public.posts(id) on delete cascade,
  page         text not null,
  query        text not null,
  date         date not null,
  clicks       int  not null default 0,
  impressions  int  not null default 0,
  position     real not null default 0,
  primary key (domain_id, page, query, date)
);

-- The one read this table exists for: "the queries this post ranks for, most
-- recent sync first."
create index if not exists gsc_page_queries_post_idx
  on public.gsc_page_queries (post_id, date desc);

comment on table public.gsc_page_queries is
  'Which search queries each page actually ranks for, from the page+query dimension pair. Feeds refresh targeting: a page stuck at position 8-20 is rewritten toward the queries it already earns impressions on. post_id is resolved by trailing slug at sync time and is null for pages grove did not write.';

alter table public.gsc_page_queries enable row level security;

-- Owner reads their own rows; writes go through the service role (cron/sync),
-- which bypasses RLS — same model as gsc_metrics / gsc_daily / post_events.
create policy "own page queries" on public.gsc_page_queries
  for all using (
    exists (select 1 from public.domains d where d.id = gsc_page_queries.domain_id and d.user_id = auth.uid())
  );
