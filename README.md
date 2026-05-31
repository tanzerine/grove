# grove

SEO blog engine on autopilot — Vercel + Supabase + Anthropic.

This repo holds:
- The marketing landing page (`app/page.tsx`, `components/Landing.tsx`)
- A two-agent content pipeline (research + writer with web_search tool use)
- Voice profiling on signup, baked into every prompt
- Managed blogs served at `/b/<slug>` with sitemaps and an embed.js
- Supabase auth + RLS for multi-tenant isolation

## Architecture

```
Visitor → app/page.tsx (landing)
         └→ /signup → Supabase Auth
              └→ /onboarding/domain  (insert domains row)
                   └→ /onboarding/verify  (DNS TXT or HTTP file)
                        └→ kickoffProvisioning(): voice profile + first topic queued
                             └→ /api/cron/scheduler  (hourly):
                                  - drain queued → researching → writing → review|scheduled
                                  - publish scheduled posts whose time has come
Reader → /b/<slug>/<post>   (managed blog)
       → /api/embed/<slug>  (JSON feed for customer's main site)
```

Source: distilled from the `crossplatform saas` Obsidian folder
(`autoblog-product-context.md`, `SAAS.md`, `Code.md`).

## Setup

```bash
pnpm i        # or npm install / yarn
cp .env.example .env.local
# fill in Supabase + Anthropic keys
pnpm supabase db push   # apply supabase/migrations/0001_init.sql
pnpm dev
```

## Deploy

```bash
vercel link
vercel env add ANTHROPIC_API_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add CRON_SECRET
vercel --prod
```

`vercel.json` registers the hourly cron for `/api/cron/scheduler`.

## Where the brand-system rules live

`lib/pipeline/quality-rules.ts` — banned phrases, recycled stats, prose pattern rules.
`lib/pipeline/writer.ts` — system prompt for the writer (voice + rules + workflow).
`lib/pipeline/validator.ts` — post-write checks that flag drafts before publish.

## Notes

- Subdomain blogs in v1 are served from the grove root (`<slug>.grove.so` or `/b/<slug>`).
  CNAME-to-customer-subdomain support is on the roadmap.
- Cross-posting to X/LinkedIn/Instagram is generated and stored in `posts.social` —
  scheduled-delivery integrations land next.
