-- 0023: manual brand-color override. When a customer's homepage crawl guesses
-- the wrong palette (or their brand differs from what the CSS exposes), they can
-- pick primary/secondary colors in the dashboard. This full derived BrandColors
-- object takes precedence over site_profile.branding on every blog surface
-- (hosted pages + embed). Crawling only rewrites site_profile, so an override
-- set here survives a re-crawl. NULL = use the crawled colors.

alter table public.domains
  add column if not exists brand_override jsonb;

comment on column public.domains.brand_override is
  'Owner-picked brand palette (full BrandColors object derived from primary/secondary). Overrides site_profile.branding on all blog surfaces. NULL = use crawled colors.';
