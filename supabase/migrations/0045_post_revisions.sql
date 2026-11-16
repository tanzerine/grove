-- The text an article had BEFORE an in-place SEO refresh replaced it.
--
-- A refresh rewrites a live article where it stands (same row, same slug, same
-- URL), so without this the previous words are gone the moment the update
-- lands. One row per refresh, written before the update, so any rewrite can be
-- undone by copying the columns back onto the post.
--
-- `evidence` is why the rewrite happened: the Search Console queries and
-- positions the post had at the time, which is also what a later run reads to
-- judge whether the refresh moved anything.
--
-- Service-role only: RLS on, no policy (same reasoning as mcp_keys). Safe on
-- arrival and safe to re-run — `if not exists` throughout.
create table if not exists public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  domain_id uuid not null references public.domains(id) on delete cascade,
  title text,
  body_md text not null,
  meta_title text,
  meta_description text,
  reason text,
  evidence jsonb,
  created_by text not null default 'seo-refresh',
  created_at timestamptz not null default now()
);

create index if not exists post_revisions_post_idx
  on public.post_revisions (post_id, created_at desc);

alter table public.post_revisions enable row level security;

comment on table public.post_revisions is
  'Pre-refresh copy of an article, written before an in-place SEO rewrite so it can be rolled back. Service-role only. evidence = the GSC queries/positions that motivated the rewrite.';
