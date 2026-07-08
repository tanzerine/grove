-- 0021: owner-adjustable article-banner link. The "Try {business}" CTA at the
-- bottom of every article (hosted blog + embed API) links here when set — e.g.
-- a signup, pricing, or campaign page. NULL keeps the default homepage link.

alter table public.domains
  add column if not exists cta_url text;

comment on column public.domains.cta_url is
  'Absolute https URL the article-bottom CTA banner points at (e.g. https://example.com/signup). NULL = link to the homepage.';
