-- 0025: per-domain autopilot publish bar. The quality score (0-100) a draft
-- must clear to auto-publish when auto_publish is on. Default 45 matches the
-- previous hard-coded AUTO_PUBLISH_FLOOR, so behavior is unchanged until an
-- owner moves the slider. Fatal checks (rejects, block-severity issues, the
-- deterministic validator) still gate regardless of this number.

alter table public.domains
  add column if not exists auto_publish_floor int not null default 45
    check (auto_publish_floor >= 0 and auto_publish_floor <= 100);

comment on column public.domains.auto_publish_floor is
  'Minimum manager quality score (0-100) an autopilot draft must reach to publish without a human. Default 45. Fatal issues still gate independently.';
