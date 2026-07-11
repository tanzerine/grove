# CLAUDE.md — Grove

Onboarding for a new session. Read this first.

## What Grove is

Grove is an **agentic SEO autoblog SaaS**. A customer connects their domain; Grove
researches, writes, quality-gates, and publishes blog posts on autopilot, then
reports outcomes (reads, conversions, search share) back in plain language. The
product pitch is **retention + exposure for the customer's own domain** — it must
feel like an agentic marketing teammate, not a CMS.

Stack: Next.js 15 (App Router, RSC), React 19, TypeScript, Supabase (Postgres +
Auth + Storage + RLS), Tailwind, Replicate (LLM + image gen), Vitest. Deployed on
Vercel. Design system: paper/ink/moss palette, Clash Display + General Sans + DM
Mono, defined in `app/globals.css` (`--ink #1a2e1f`, `--moss #4e9e6a`,
`--clay`, `--paper`, `--line`).

## The two repos — DO NOT CONFUSE THEM

1. **grove** (this repo, `github.com/tanzerine/grove`, clone at `~/Downloads/grove`)
   — the SaaS: dashboard, pipeline, APIs, hosted blog at `/b/[slug]`, embed.js.

2. **ovenai** (`github.com/tanzerine/ovenai`, clone at `~/Downloads/ovenai` on `main`)
   — a *customer's* marketing site (Oven AI, oveners.com). Separate Next.js app.
   It consumes Grove's embed API and renders its own `/blog`. **When a user reports
   a bug on `oveners.com/blog`, it is almost always THIS repo, not grove** — the
   recurring "shows 6 / says AI / no author" issues all lived here. The blog list
   now renders via grove's `#grove-blog` embed; `/blog/[slug]` stays server-rendered
   for SEO.

## Architecture (grove)

Four-layer agent loop (see `ARCHITECTURE.md` for detail):
`STRATEGY → GENERATION → MANAGER → ANALYTICS`, looping monthly.

- **Strategy** (`lib/strategy/`) — monthly plan per domain (goals, pillars, KPIs,
  publishing plan). `build.ts` (inferred) + `interview.ts` (owner input).
- **Generation** (`lib/pipeline/generate.ts`) — 5-step pipeline: site-profile →
  research (Tavily) → topic-refiner → writer → manager gate. Logs to
  `posts.generation_log` for the live UI timeline.
- **Manager** (`lib/pipeline/manager.ts`) — LLM evaluator, scores 0–100 across
  strategic_fit / marketing / craft / safety, action = approve|rewrite|reject.
  Never deletes a finished draft; concerns route to human `review`. Persists to
  `post_evaluations`.
- **Analytics** (`lib/analytics/`) — first-party event stream (`post_events`),
  no third-party JS. `lib/strategy/review.ts` aggregates it into the monthly report.

Other key surfaces:
- `lib/agent-brief.ts` — plain-English weekly brief on the dashboard home.
- `lib/seo.ts` — **single source for every public blog URL** (`blogHomeUrl`,
  `blogPostUrl`, `appBase`, `isBot`, `subdomainSlugFromHost`). Never hand-build a
  blog URL; use these so canonical/sitemap/RSS/social/webhook shapes can't diverge.
- `lib/blog-genre.ts` — `genreFor(format, title)` (maps pipeline format → reader
  genre, EN+KO heuristics), `authorFor(profile, host)` (founder name or
  "{Business} Team", never "AI").
- `lib/related-posts.ts` / `lib/internal-links.ts` — retention + in-body SEO links
  (CJK-aware tokenizer).
- `lib/social/` — OAuth posting (X/LinkedIn/IG) + outbound webhook fallback.
- `public/embed.js` — the customer-facing embed. Modes: `#grove-blog` (full blog
  SPA), `#grove-widget` (teaser), `#grove-feed` (legacy). `data-article-base`,
  `data-accent`, `data-count`, `data-blog-url`.
- `app/dashboard/QualityCharts.tsx` — ScoreRing / RubricBars / QualityColumns;
  `bandColor()` is the single source for score-band colors (≥70 moss, ≥40 amber, else red).

## Working conventions

- **Match the surrounding code.** Inline styles with CSS vars are the norm in
  dashboard/blog components; no styled-components/CSS modules. Pure logic lives in
  `lib/` and is unit-tested; React pages stay thin.
- **Verify before claiming done:** `npm test` (Vitest) AND `npm run build`. The
  build type-checks (`next.config.mjs` has `typescript.ignoreBuildErrors: false`),
  so a green build is the type gate. Tests live in `tests/*.test.ts`.
- **Write tests for pure functions** you add in `lib/` (genre, seo, related-posts,
  internal-links, agent-brief, social all have suites — follow their style).
- **PR workflow:** branch → commit → push → `gh pr create` → merge. Commit messages
  end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. For messages
  with quotes/arrows, use `git commit -F <file>` (shell mangles `→`/quotes).
- **MERGE RULE:** grove PRs may be merged to `main` WITHOUT per-merge confirmation
  (standing user instruction). **ovenai PRs must NOT** — ask first.
- **Never `git push` straight to `main`** (the harness blocks it) and never `db push`
  to production without explicit user OK — both are guarded on purpose.

## Supabase

- Project ref `lojgijnjagaozrrpjlbj`. CLI is linked locally (no `.env` in repo —
  secrets live in Vercel). Migrations in `supabase/migrations/` (0001–0025).
- History was repaired so 0001–0009 are marked applied; `npm run db:push` applies
  only new ones. **Always run `supabase migration list` first instead of trusting
  this file** — as of 2026-07-11, 0001–0023 are applied (0018 canonical_blog_base
  included) and **0024_ga4 + 0025_auto_publish_floor are committed but NOT yet
  pushed** (needs explicit user OK; until 0025 lands, the deployed publish-bar
  slider reads its default but can't persist changes).
- `domains.canonical_blog_base` makes the customer's own URLs canonical
  everywhere (rel=canonical, sitemap, RSS, social). It must also be SET per
  domain — the column existing isn't enough.
- `supabase/.temp/` is gitignored (CLI artifacts).

## Env vars that gate features (set in Vercel, not the repo)

- `REPLICATE_API_TOKEN` — generation. `NEXT_PUBLIC_APP_URL` — canonical origin.
- `GROVE_BLOG_ROOT_DOMAIN` — when set, blogs serve at `{slug}.{root}` (needs wildcard
  DNS + Vercel wildcard domain); unset → `/b/{slug}` paths.
- `SOCIAL_TOKEN_KEY` — AES key for stored OAuth tokens (unset = plaintext fallback,
  dev only). `X_/LINKEDIN_/FACEBOOK_` client creds gate the social Connect buttons.
- `RESEND_API_KEY` — weekly digest emails (degrades gracefully if unset).
- `CRON_SECRET` — guards `/api/cron/*`.

## Gotchas learned

- ovenai's local `next build` fails on `/api/stripe-webhook` (`supabaseUrl is
  required`) because its env isn't in the local checkout — Vercel has it. Verify
  ovenai with `npx tsc --noEmit` instead.
- Public blog pages cache the feed ~5 min (`revalidate: 300` / CDN s-maxage). After
  a deploy, allow a few minutes before concluding a change didn't work.
- `reads` feeds the strategy loop, so it's incremented for humans only (bot UAs
  filtered via `lib/seo.ts isBot`).
- Social URLs come from `lib/seo` builders (and `lib/social/compose.blogUrlFor`
  delegates to them) — keep it that way.
