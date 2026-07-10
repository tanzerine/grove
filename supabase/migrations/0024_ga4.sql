-- ─────────────────────────────────────────────────────────────
-- 0024_ga4.sql
-- Google Analytics 4 connection. GA4 is Grove's first WHOLE-SITE signal:
-- Search Console + first-party events only ever see blog articles, but the
-- owner compares Grove against GA, which counts the landing page, pricing,
-- the blog index — everything. We reuse the existing Google OAuth refresh
-- token (`gsc_refresh_token`); GA just needs the analytics.readonly scope
-- (added to the shared consent) plus the numeric property id to query.
--
-- No metrics table: GA is queried LIVE per dashboard load for the selected
-- date range, so the 7d/30d/90d/12mo selector stays honest with zero storage.
-- ─────────────────────────────────────────────────────────────

alter table public.domains
  add column if not exists ga4_property_id  text,          -- numeric GA4 property id, e.g. '123456789'
  add column if not exists ga4_connected_at timestamptz;   -- when the property was resolved + stored
