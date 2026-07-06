-- 0018: per-domain canonical blog base — SEO equity accrues to the CUSTOMER's
-- domain, not grove's. When set (e.g. https://example.com/blog), every absolute
-- article URL grove emits — rel=canonical, OG, JSON-LD, sitemap <loc>, RSS
-- links, llms.txt, social shares, embed post URLs — points at the customer's
-- own pages; the grove-hosted blog ({slug}.{root} or /b/{slug}) becomes a
-- non-canonical mirror. NULL keeps today's grove-hosted URLs.

alter table public.domains
  add column if not exists canonical_blog_base text;

comment on column public.domains.canonical_blog_base is
  'Absolute base URL on the customer''s own domain where articles are served (no trailing slash, e.g. https://example.com/blog). Article URLs are {base}/{post_slug}. NULL = grove-hosted URLs are canonical.';
