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
   recurring "shows 6 / says AI / no author" issues all lived here.

   **oveners.com does NOT load embed.js at all** (an earlier version of this file
   claimed the list had moved to `#grove-blog`; verified false on 2026-08-02 —
   the live HTML has ovenai's own `m-blog-featured` markup and no embed script).
   Both blog surfaces are ovenai's own server-rendered React, fed by grove's
   embed *API*:
   - `/blog` (list) — `components/blog/BlogContent.tsx` + `lib/grove.ts`, which
     pages `/api/embed/host/oveners.com` server-side and draws its own cards,
     search, genre chips and pagination. **This duplicates embed.js's list
     logic**, so a list-level fix has to be made in both places — that's the
     cost of the current setup, not a bug to "fix" by assuming the embed is there.
   - `/blog/[slug]` (article) — renders the API's **`html`** field (ovenai#8,
     2026-08-02), so the sticky TOC rail, the CTA and the article chrome all come
     from grove and an upstream fix lands on oveners.com automatically. It maps
     grove's `--gv-*` properties onto its own tokens and scopes its prose CSS to
     `.grv-body`. Before that it rendered the `body_md` fallback, which is why
     the same post had a boxy inline TOC there and a sidebar on grove's copy.
     If you change the shape of `html`, check that page.

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

**Throughput / capacity** (`lib/pipeline/capacity.ts`) — platform generation
capacity is `ticks per day × posts per tick`. Ticks/day is parsed from the
scheduler's schedule in `vercel.json` (its only source of truth); posts/tick is
whatever fits the invocation's wall-clock budget at the *measured* p80 cost of
recent generations (read back from `posts.generation_log`). **To raise
throughput, change the cron schedule — not the code.** Every figure follows
automatically, including the oversold-capacity flag on the admin overview
(`lib/anomaly.ts`), which compares sold plan quota against deliverable capacity.
Set `GROVE_TICK_BUDGET_MS` when the plan's real function ceiling is below the
route's declared `maxDuration` (Vercel Hobby caps at 60s regardless; on the
current Pro account the declared 300s is honoured, so leave it unset).

The account is on **Vercel Pro**, so sub-daily crons are allowed. Three hourly
300s functions, offset so they never fire together: the scheduler at :00,
`/api/cron/images` at :30, `/api/cron/strategy` at :45. Phases that don't need
every tick opt out — the Search Console sync runs on one tick a day
(`shouldSyncGsc`), handing its reserve back to generation on the other 23. If
you ever need more, `*/15 * * * *` is the next step and every figure follows.

**Real throughput is ~1 article per tick, so ~24/day (~720/month) — NOT the
~47/day this file used to claim.** Measured generation is ~138s p80, which does
leave room for two in a 300s tick on paper, but the drain also takes the fresh
draft's cover inline when it fits (`COVER_COST_MS`, 75s): 138 + ~60 = ~198s
elapsed, and 198 + 138 overruns 300, so the second article never starts.
`postsPerTick(300s, 138s)` reports the same 1. Size plans against 720/month —
50 customers fit on Starter (12/mo → 600) and do **not** fit on Growth
(40/mo → 2,000). The dial is the cron schedule, not the code.

**Work that needs a big uninterrupted slice gets its own cron.** Both images and
strategy were starved when they shared a tick with the generation drain, and
strategy's failure was silent: squeezed into 120s, it sat under
`strategyLlmCall`'s minimum budget and every automated plan was quietly built by
the cheap workhorse instead of the strategy model. If you add a step that needs
minutes rather than seconds, give it a route, not a slice.

**Free beta + feedback funnel** (0033/0034) — `lib/beta.ts` is the pure grant
logic and settles the precedence every reader follows: **comped > live Stripe >
beta grant > plan catalogue**. A beta grant is deliberately *not* `comped`: it is
bounded on both axes (`beta_posts_quota` posts/month, expiring at
`beta_expires_at`) because platform capacity is a fixed ~720 posts/month and an
unmetered guest spends a paying customer's share. `/dashboard/admin/beta` shows
what share of capacity is being given away. Codes live in `beta_coupons` (RLS on,
**no policy** — service-role reads only, so codes can't be enumerated) and
redemption is guarded by a CAS on `redeemed_count` plus `unique(user_id)` on
`beta_redemptions`. Customer→owner feedback is one table with a `kind`
discriminator (testimonial | shortcoming | complaint) — `lib/feedback.ts` for the
vocabulary, `lib/feedback-store.ts` for the queries, `/dashboard/admin/feedback`
for triage. **A testimonial reaches the landing page only when it is both
`consent_publish` and `published`**, checked on the way in (the admin PATCH) and
again on the way out (`publishedTestimonials`). The landing renders nothing when
there are no real quotes — that page has always refused invented social proof.

**Beta-tester outreach** (0035, `lib/outreach/`) — the top of that same funnel:
find Reddit posts whose author describes a problem Grove solves, and draft the
DM that offers them a beta code. `/dashboard/admin/outreach`.
- `screen.ts` (pure) — six `PainKind`s, each with patterns, a weight and, in
  `dm.ts`, its own bridge paragraph. Scoring is deliberately **asymmetric**:
  pain earns points slowly, and a `hard` blocker (`no_dm`, `competitor`,
  `for_hire`, `anti_ai`, deleted author) forces tier `skip` at any score. The
  expensive failure is never a missed prospect; it's a pitch sent to someone who
  said don't. Every verdict carries **evidence** — the author's own sentence —
  which is both what makes it auditable and what the DM's first line quotes.
- `dm.ts` (pure) — opener (their words) + bridge (per pain) + fixed spine. The
  spine is byte-identical in every variant on purpose: the honest caveat ("it
  won't get you a paying customer this month") only means something if it went
  out in every message. `personalize.ts` may rewrite **the opener and nothing
  else**, and falls back to the deterministic draft on any failure.
- **There is no send path anywhere in this feature, and adding one would be a
  mistake.** No OAuth, no Reddit write scope; drafts are copied out by a human.
  The review step between a regex score and a stranger's inbox is the product.
- `outreach_prospects` is unique on `(source, lower(author))` — that index is
  the guarantee nobody is DMed twice, including people already marked `skipped`.
- **Anonymous Reddit reads 403 from Vercel and a User-Agent does not fix it** —
  the block is on the IP range, not the client string. Confirmed in production
  on the first scan. The fix is app-only OAuth: set `GROVE_REDDIT_CLIENT_ID` /
  `GROVE_REDDIT_CLIENT_SECRET` (a "script" app at reddit.com/prefs/apps) and
  `fetchListing` reads from `oauth.reddit.com` instead, at a documented 100
  req/min. Unset → falls back to anonymous `www.reddit.com`, which works from a
  laptop. `GROVE_REDDIT_USER_AGENT` is still required either way.
  **The app-only token does not weaken the no-send rule**: `client_credentials`
  carries no user context, so it cannot message, post or vote — messaging needs
  a user-authorized write scope, which nothing here requests or stores.
  The 403 message differs depending on whether we were authenticated, because
  "get credentials" is the wrong advice for someone who already has them.

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
  `data-accent`, `data-count`, `data-blog-url`, `data-theme` (light|dark|auto),
  `data-host` (pin the domain instead of auto-detecting — previews and localhost
  don't own a blog). Every surface color must resolve through a `--gv-*`
  property or dark mode half-applies; `tests/embed-theme.test.ts` enforces it.
- **The embed's SEO hinges on one thing: does the domain have a crawlable base?**
  `lib/embed-seo.ts embedSeoStatus()` is the single answer, read by both the
  dashboard badge and the list API's `blog_base` field. With a base (subdomain
  or `canonical_blog_base`), embed.js links cards at real URLs **by default** —
  `data-article-base` is now only an override, so connecting a subdomain
  upgrades snippets already pasted on customer sites with no edit. Without one,
  articles open in the hash reader at `#grove/<slug>`, which no crawler indexes:
  the reader then injects `rel=canonical` + Article JSON-LD pointing at the
  crawlable copy and **restores the page's original canonical on the way back**
  (`tests/embed-head.test.ts` runs that round-trip against a fake DOM — an
  article canonical left on the list view is worse than none). Subfolder
  customers get proxy configs from `lib/rewrite-snippets.ts`.
- **MCP content API** (`lib/mcp/`, `app/api/mcp`, `/dashboard/mcp`) — the answer
  for a customer with a *thick* blog: they already have a content layer (MDX in
  a repo, a CMS, their own pipeline) and want grove's articles INSIDE it, not an
  embed beside it. Their coding agent connects over MCP and pulls finished
  articles already shaped for that layer. **This is a second distribution path,
  not a replacement** — embed, hosted mirror and MCP all serve the same posts.
  - Transport is Streamable HTTP, stateless, hand-rolled (no SDK): one POST of
    JSON-RPC in, one JSON response out, no session id, no SSE. `lib/mcp/protocol.ts`
    is the framing; `GET /api/mcp` is deliberately 405 (grove never pushes).
  - Auth is a per-user bearer key, `gv_mcp_…`, **stored only as sha256** and
    looked up by that digest (0036). `lib/mcp/auth.ts` is the entire security
    boundary: handlers run on the service-role client, so every query is scoped
    by hand through `resolveSite()` — a posts query without a resolved
    `domain_id` is a cross-tenant read. `mcp_keys` has RLS with **no policy**
    (service-role only, same reasoning as `beta_coupons`).
  - `pull_new` is the incremental sync and `mcp_deliveries` is its ledger: the
    agent records where each article went live, so the next pull returns only
    what's genuinely new and the dashboard can show what actually shipped.
  - **Two things break silently once the customer renders the articles**: the
    analytics beacon stops firing (so `reads`, the whole reporting surface and
    the monthly strategy loop go blind) and grove's mirror stays canonical. The
    `integration_guide` tool leads with both, and `set_canonical_base` writes
    the same `domains.canonical_blog_base` the dashboard form does — via
    `normalizeCanonicalBase`, never raw.
  - Formatters live in `lib/mcp/format.ts`. `mdx` escapes `{` and bare `<`
    **outside code fences**: markdown renderers tolerate them, the MDX compiler
    doesn't, and an import that breaks the customer's build is worse than no
    import at all.
- **grove eats its own dogfood**: `/blog` (`app/blog/page.tsx`) and the landing's
  "Our blog runs on grove" section mount that same embed via
  `components/GroveEmbed.tsx`, against grove's own `trygroveai.com` domain row.
  Deliberately no bespoke CSS there — a rendering bug is a bug in embed.js, so
  fix it upstream. NOTE: load embed.js with `next/script` (`afterInteractive`),
  never a bare `<script async>` — the bare tag can beat hydration and React
  then deletes the mounted DOM. The cards point at the grove-hosted articles
  (`data-article-base`) so they stay crawlable.
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
  secrets live in Vercel). Migrations in `supabase/migrations/` (0001–0036).
- History was repaired so 0001–0009 are marked applied; `npm run db:push` applies
  only new ones. **Always run `supabase migration list` first instead of trusting
  this file** — as of 2026-08-14, **0001–0036 are all applied** (verified against
  `information_schema`, not just the migration list). 0029
  (`strategies.planned_by`) records which model built each plan; the insert in
  `lib/strategy/ensure.ts` retries without the column, so an unapplied migration
  there degrades to "no diagnostic" rather than "no plan". 0036 (`mcp_keys`,
  `mcp_deliveries`) is the newest: both tables exist, RLS on, `mcp_keys` with
  zero policies as intended.
- **Version numbers collide, because branches don't see each other's migrations.**
  0036 (`mcp_keys`) was written as 0035 on a branch cut before 0035
  (`outreach_prospects`) existed anywhere local; by push time that number was
  already applied in production, and the file had to be renumbered. Both are in
  the tree now, which is exactly what makes this easy to forget. So: **the live
  `migration list` is the only source of truth for the next free number** —
  `ls supabase/migrations/` tells you what your branch knows, which is a
  different question. A local file whose version is already applied under a
  different name is the failure to look for.
- **A migration can reach production without anyone running `db:push` here.**
  0029 was authored and merged in one session and was already live before that
  session ever pushed — the column comment matched the migration file verbatim,
  so it was that file that ran, applied by something outside the session (a
  Supabase GitHub integration configured in the dashboard, or a concurrent
  session). Treat merging a migration to `main` as potentially shipping it.
  Write migrations to be safe on arrival, and always verify live schema state
  rather than assuming your own `db:push` is the gate.
- `domains.canonical_blog_base` makes the customer's own URLs canonical
  everywhere (rel=canonical, sitemap, RSS, social). It must also be SET per
  domain — the column existing isn't enough.
- `domains.custom_blog_hostname` (0026) — customer CNAMEs e.g. `blog.acme.com`
  at grove; middleware serves the whole blog there (zero customer code). Read it
  via `lib/seo canonicalBaseFor()/servedBlogBaseFor()`, never raw. The hostname
  must ALSO be attached to the Vercel project or Vercel won't route/TLS it —
  DNS + DB alone aren't enough. This attach is now **automated**: setting the
  hostname (settings API) attaches it to the Vercel project via
  `lib/vercel/domains.ts`, and `/api/cron/domains` (daily 02:00) re-attaches
  idempotently to self-heal transient failures. The dashboard embed page polls
  `/api/domains/hostname-status` (attach + DNS + serving probes; pure
  classification in `lib/hostname-status.ts`) so setup is a self-verifying
  checklist. Both attach paths no-op when
  `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` are unset (manual attach is the
  fallback), so the feature still serves once the host is added by hand.
- **Applying a migration through the Supabase MCP re-keys it.** `apply_migration`
  records the row under a generated timestamp version (`20260812122243`), not the
  repo's `0035`. The CLI then reads 0035 as unapplied and `db push` re-runs the
  file — harmless when it's `if not exists` throughout, and not harmless
  otherwise. 0035 was repaired by hand (`update schema_migrations set version`),
  and 0036 hit exactly the same thing a fortnight later — assume it happens every
  time. If you apply through the MCP, check `schema_migrations` and re-key it to
  match the filename.
- `supabase/.temp/` is gitignored (CLI artifacts).

## Env vars that gate features (set in Vercel, not the repo)

- `REPLICATE_API_TOKEN` — generation. `NEXT_PUBLIC_APP_URL` — canonical origin.
- `GROVE_BLOG_ROOT_DOMAIN` — when set, blogs serve at `{slug}.{root}` (needs wildcard
  DNS + Vercel wildcard domain); unset → `/b/{slug}` paths.
- `SOCIAL_TOKEN_KEY` — AES key for stored OAuth tokens (unset = plaintext fallback,
  dev only). `X_/LINKEDIN_` client creds gate the social Connect buttons.
- `RESEND_API_KEY` — weekly digest emails (degrades gracefully if unset).
- `CRON_SECRET` — guards `/api/cron/*`.
- `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — auto-attach a
  customer's `custom_blog_hostname` to the Vercel project (needs a token with
  Domains scope). Unset → auto-attach no-ops, hostname must be added by hand.

## Gotchas learned

- ovenai's local `next build` fails on `/api/stripe-webhook` (`supabaseUrl is
  required`) because its env isn't in the local checkout — Vercel has it. Verify
  ovenai with `npx tsc --noEmit` instead. Its `next dev` doesn't run either:
  Clerk middleware throws `Missing publishableKey` on EVERY route, so you cannot
  render an ovenai page locally at all. To check an ovenai blog change visually,
  rebuild the page's markup + CSS in a scratch HTML file against the live
  `/api/embed/host/...` payload (CORS is open), then confirm on the Vercel
  preview or after deploy — and say which of the two you actually did.
- Public blog pages cache the feed ~5 min (`revalidate: 300` / CDN s-maxage). After
  a deploy, allow a few minutes before concluding a change didn't work.
- `reads` feeds the strategy loop, so it's incremented for humans only (bot UAs
  filtered via `lib/seo.ts isBot`).
- Social URLs come from `lib/seo` builders (and `lib/social/compose.blogUrlFor`
  delegates to them) — keep it that way.
