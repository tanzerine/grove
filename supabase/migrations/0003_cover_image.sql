-- Cover image (from Unsplash). Stored as plain URL + attribution.
alter table public.posts
  add column if not exists cover_image_url    text,
  add column if not exists cover_image_credit jsonb;  -- { name, profile_url, source }
