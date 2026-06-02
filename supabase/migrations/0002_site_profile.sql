-- Richer per-domain context: what the business does, who they sell to,
-- their products, geography, etc. Feeds every article writer call.
alter table public.domains
  add column if not exists site_profile jsonb;
