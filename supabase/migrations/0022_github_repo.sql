-- 0022: GitHub repo connection for product knowledge.
--
-- The site crawl sees marketing copy; the repo sees the actual product —
-- README, docs/, changelog. Connecting a repo lets the pipeline write
-- step-by-step tutorials and feature deep-dives grounded in real features
-- instead of guessed ones.
--
--   github_repo        — "owner/repo" the customer connected. NULL = not connected.
--   github_repo_token  — optional fine-grained PAT for private repos, encrypted
--                        with the same AES-GCM helper as social OAuth tokens
--                        (lib/social/crypto.ts, SOCIAL_TOKEN_KEY).
--   repo_knowledge     — extracted RepoKnowledge JSON (lib/pipeline/repo-knowledge.ts).
--                        Kept OUTSIDE site_profile so a site re-crawl never wipes it.

alter table public.domains
  add column if not exists github_repo text,
  add column if not exists github_repo_token text,
  add column if not exists repo_knowledge jsonb;

comment on column public.domains.github_repo is
  '"owner/repo" of the connected GitHub repository. NULL = no repo connected.';
comment on column public.domains.github_repo_token is
  'Optional encrypted fine-grained PAT (read-only Contents) for private repos.';
comment on column public.domains.repo_knowledge is
  'Product knowledge extracted from the repo (summary, features, how-to steps). Feeds tutorial/deep-dive article formats.';
