-- Cap cover-generation retries. The images cron re-selects any post whose
-- cover_image_url is NULL, so a post whose prompt persistently fails the image
-- model (e.g. content filter) was re-billed every single day forever. The
-- pipeline gives up once cover_attempts reaches its budget (see
-- MAX_COVER_ATTEMPTS in lib/pipeline/cover-image.ts); the manual "regenerate
-- cover" action bypasses the cap.
alter table public.posts
  add column if not exists cover_attempts integer not null default 0;
