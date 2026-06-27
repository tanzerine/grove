# Grove skin — design comps

Standalone DesignComponent (`.dc.html`) mockups of the grove product skin. Each file is a
self-contained React component (via `support.js` / `DCLogic`) rendering one screen in the
shared visual language: `#0a0b0a` canvas, `#101310` cards, `#0c0e0c` sidebar, Plus Jakarta
Sans, `#63c281` accent + animated glow, `_icon()` SVG factory, and band colors
(≥70 green / ≥40 amber / else red).

These are **design references, not shipping app code** — use them to drive the real
Next.js UI.

## Screens

| File | Screen | Notes |
|------|--------|-------|
| `Grove Landing.dc.html` | Marketing landing | Hero, refraction beams, features, pricing, FAQ |
| `Grove Home.dc.html` | Main dashboard / Home | Agent hero, outcome stats, recent wins, "needs you" |
| `Grove Dashboard.dc.html` | Overview (original) | Calendar + agent panel + pipeline table |
| `Grove Strategy.dc.html` | Strategy | Goal rings, topical authority hub-spoke map, pillars, plan timeline |
| `Grove Pipeline.dc.html` | Content pipeline | Live agent loop, queue, manager quality bars |
| `Grove Review.dc.html` | Draft review | Manager score ring + rubric, plain-language readiness, SERP coverage |
| `Grove Analytics.dc.html` | Analytics | KPIs, organic chart, traffic sources, citations, funnel |

## Nav taxonomy

Home / Strategy / Pipeline · Calendar / Reviews / Analytics · Brand voice / Social / Embed.
(`Grove Dashboard.dc.html` predates this and still uses the older Workspace/Growth/Setup grouping.)
