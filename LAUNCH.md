# Grove — launch plan

Written 2026-07-28. Horizon: four weeks, Product Hunt on **Tue 18 Aug**.

Every number in here was pulled from production, not estimated. Where a claim is
weak, it says so — the whole positioning depends on being the honest one in a
category full of slop vendors, and that starts with our own copy.

---

## 0. Where we actually stand

| Fact | Value | Source |
|---|---|---|
| Domains producing content | **1** (`www.oveners.com`) | `domains` × `posts` |
| Posts published, all-time | **36** (3 Jun → 27 Jul) | `posts.status='published'` |
| Paying customers | **0** | `subscriptions` |
| Signups that never generated a post | **3 of 3** | `posts_used = 0` |
| grove's own blog | **0 published, 16 stuck in `review`** | `trygroveai.com` |
| Manager gate: drafts not approved first pass | **90 of 110 (82%)** | `post_evaluations` |

Two of those rows are launch blockers, and one of them is the best marketing
asset we have. Read §1 before anything else.

### The oveners result — our only real proof

Search Console, weekly, for the one site grove has been running:

| Window | Clicks / wk | Impressions / wk | Avg. position |
|---|---|---|---|
| Pre-grove (6 Apr – 1 Jun, median) | **9** | ~312 | **14.2** |
| Last 4 weeks (29 Jun – 20 Jul) | **23.5** | **377** | **10.4** |

The four most recent weeks, in order: 284 → 322 → 424 → **478** impressions,
with average position going 15.5 → 8.7 → 8.6 → **8.6**. Page two to page one,
while volume climbed 68%.

Caveats to state out loud whenever we use this: one site, eight weeks, small
absolute numbers, and correlation rather than proof. Publish the raw chart with
the caveats attached. In a category where everyone claims "10x your traffic,"
a modest number with its warts showing is *more* persuasive, not less.

---

## 1. Fix these before spending a single hour on promotion

**1. Onboarding kills every signup that isn't you.** Three people signed up in
late June. All three generated zero posts. Two of them typed `google.com` as
their domain — which reads like someone poking at the form, hitting the DNS TXT
verification wall, and leaving. Right now a stranger must prove domain ownership
*before* they see a single sentence grove wrote. That is backwards. Let a new
account generate one real post from the URL alone, and gate only *publishing*
behind verification. Without this, a Product Hunt launch is a bucket with no
bottom — a thousand visitors will produce a thousand bounces at the same wall.

**2. grove's own blog is empty.** 16 posts sitting in `review`, 0 published, and
the landing page tells visitors "Our blog runs on grove" above an empty embed.
For a product whose entire promise is "your blog will fill itself," this is the
single most damaging thing on the site. Review and publish those 16 this week.
They then become both the proof *and* the top-of-funnel.

**3. The hero sentence is ungrammatical.** `components/Landing.tsx` currently
reads "Grove is the fully autonomous agent grows your search traffic" — a missing
"that." Replacing it is §3 anyway.

**4. Nobody has ever completed a checkout.** Three subscription rows, all with
`stripe_status = null`. Put a real card through the full Starter flow and confirm
the webhook writes `active` before driving traffic at it.

Blockers 1 and 2 are the week-one work. Nothing else in this plan matters if a
visitor can't reach a generated article.

---

## 2. Positioning

### The trap to avoid

"AI writes your blog posts" is a red ocean — a dozen tools at $19–49/mo say
exactly that, and the phrase now carries its own objection: *AI content is slop
and Google punishes it.* Competing there means competing on price and inheriting
a reputation problem we didn't create.

### The wedge: we're the only one that says no

The manager agent sends back **82% of first drafts**. Every competitor sells
volume — posts per month, keywords per hour. We can sell the opposite, and it's
the thing a solo founder actually feels anxious about: *this is going on my
domain, under my name, in front of my customers.*

That reframes the category. Not a content generator. **A marketing hire with a
standard.** The four things a founder can't do alone — decide what to write,
write it, judge whether it's good, and tell you if it worked — are exactly the
four agents in the loop. ChatGPT gives you a draft. It doesn't give you a plan,
a standard, a publish, or a report.

### The three pillars, in priority order

1. **It has taste.** An editor agent scores every draft 0–100 and rejects weak
   ones. 8 of 10 first drafts don't survive it. *(Kills the slop objection, which
   is the #1 reason this buyer says no.)*
2. **It's a teammate, not a tool.** Strategy → writing → gate → publish →
   plain-English monthly report. You don't operate it; you read what it did.
   *(Kills "I don't have time to learn another tool.")*
3. **It needs nothing from you.** No WordPress, no CMS, no migration. One script
   tag, a hosted blog, or a CNAME. Works on Framer, Webflow, Shopify, a bare
   Next.js landing page with no `/blog` at all. *(Kills "I'd have to build a blog
   first," which for this buyer is the real reason there's no content.)*

Price anchor, already half-present on the landing page and worth hammering: a
content marketer is $3–5k/mo, a freelance article is $150–400. Starter is $29.

### Who we're for — say it on the page

"Solo founders" is the target but too broad to write copy against. The buyer is:
**a technical or semi-technical solo founder with a live product, a landing page,
no `/blog`, and no intention of learning SEO.** Naming them explicitly on the site
costs us nobody and wins us the self-recognition moment.

---

## 3. The one sentence

**Hero (recommended):**

> ### Get found on Google without hiring a marketing team.
> grove is an autonomous agent that plans, writes, and publishes SEO articles to
> your site every week — and sends 8 out of 10 first drafts back for a rewrite
> before anything goes live.

Structure: **promise → mechanism → objection-killer**, in two lines. The promise
is the outcome the buyer feels (nobody knows I exist), not the mechanism they
don't care about (SEO content pipeline). The second line earns it back with the
one stat no competitor can copy.

**The "what is it?" answer — for bios, DMs, intros:**

> grove is an AI marketing teammate for solo founders — it runs your blog end to
> end so you get found on Google without learning SEO.

**Context variants:**

| Where | Copy |
|---|---|
| X bio | Building grove — the AI marketing teammate that runs your blog end to end. For founders who'd rather ship than write. |
| Product Hunt tagline | Your blog, run by an AI teammate that refuses to publish bad work |
| Show HN title | Show HN: I built an AI that writes blog posts, then one that rejects 8 of 10 |
| One-line at a party | It's a marketing employee for solo founders, for $29 a month. |
| LinkedIn headline | Founder @ grove · the AI marketing hire for founders who hate marketing |

**The test to apply to any rewrite:** would a solo founder who has never heard of
us know *what will be different about their website tomorrow*? "Grows your search
traffic" fails it. "Publishes SEO articles to your site every week" passes.

---

## 4. Channels

**X — primary.** Solo founders, indie hackers, and build-in-public live here.
It's the only one of the three where a product with zero customers can accumulate
an audience *before* it has proof, and it feeds the Product Hunt and Hacker News
crowds directly.

**LinkedIn — secondary, same content reworded.** Organic reach for text posts on
a small account currently beats X, and it reaches the half of the market that
isn't an indie hacker: agency owners, consultants, e-commerce and B2B founders
over 35 — people who have budget and openly dislike marketing. Costs ~20 minutes
a week to repurpose. Do not skip it.

**Instagram — skip entirely.** Wrong audience shape, no link surface, highest
production cost per post, near-zero purchase intent for $29/mo B2B software. It
is the worst use of the hours available. Revisit never, or at least not this
quarter.

**The channel that beats all three: our own blog.** grove publishing grove's
content *is* the demo. Every post is simultaneously proof, SEO surface, and
something to link from X and LinkedIn. This is why blocker #2 is a blocker.

**Launch surfaces (one-shot, not ongoing):** Product Hunt, Show HN, r/SaaS,
r/indiehackers, r/Entrepreneur, Indie Hackers, and any Slack/Discord for solo
founders you're already a member of.

### Content that works for this specific product

1. **The dogfood receipt** (weekly, highest value) — "grove wrote and published
   this while I slept; here's the Search Console chart three weeks later."
   Screenshot the GSC panel. This is the product working in public.
2. **The rejection angle** (highest shareability) — "I built an AI that writes
   blog posts. Then I built one that rejects them. It kills 8 out of 10." Rides
   the AI-slop backlash instead of fighting it.
3. **The oveners case study** — 36 posts, 9 → 23.5 clicks/week, position 14 → 10,
   eight weeks, with caveats. One long-form post, one X thread, one landing
   section.
4. **Build-in-public** — signups, first dollar, what broke. Including the
   onboarding wall from §1; "I found out every signup died at the same screen"
   is a genuinely good post.
5. **Free SEO teardowns** — audit a solo founder's site publicly (with
   permission), show three concrete gaps. Doubles as the warmest possible DM
   opener and generates case studies.

What not to make: generic "10 SEO tips" carousels, AI-news commentary, anything
that doesn't feature grove's own output. No audience, no differentiation.

---

## 5. The four-week plan

Weeks run Tuesday to Monday. Daily budget assumed: ~90 minutes on marketing,
because there's still a product to run.

### Week 1 · 28 Jul – 3 Aug — Unblock and stockpile

The only week with no promotion in it. Fix the funnel before pouring anything in.

- [ ] Ship pre-verification sample post (blocker #1). **Highest-value item in this document.**
- [ ] Review and publish the 16 `review` posts on `trygroveai.com` (blocker #2)
- [ ] Rewrite the hero to §3; fix the grammar bug (blocker #3)
- [ ] Put a live card through Starter checkout end to end (blocker #4)
- [ ] Set up X and LinkedIn profiles with the §3 bios; pinned post = the rejection angle
- [ ] Write and publish the oveners case study on grove's own blog — with the raw chart
- [ ] Draft the Product Hunt assets: tagline, first comment, 4 gallery images, 60s demo video
- [ ] Build a list of 100 solo founders with live products and no `/blog` (X + IH + Reddit)

**Exit criteria:** a stranger can reach a real generated article without touching
DNS, and trygroveai.com/blog is not empty.

### Week 2 · 4 Aug – 10 Aug — Start posting, get the first ten users

Content: 1 X post/day, 3 LinkedIn/week (repurposed), 2 grove posts shipping automatically.

- [ ] Mon-to-Fri X posts: rejection angle → oveners chart → onboarding-wall confession → dogfood receipt → "what I'd do with $0 and no marketing skill"
- [ ] Post the case study to r/SaaS and Indie Hackers (as a result, not a pitch)
- [ ] **20 DMs/day to the list of 100.** Offer: free public SEO teardown, no pitch. Convert the ones who bite into founding users.
- [ ] Stand up the founding-user offer: **first 25 accounts, 3 months free, in exchange for a testimonial and permission to screenshot their before/after**
- [ ] Onboard every founding user personally — watch them do it, note where they hesitate

**Exit criteria:** 10 accounts that have generated at least one post. Three
usable quotes. Every drop-off point in onboarding written down.

### Week 3 · 11 Aug – 17 Aug — Proof, then queue the launch

- [ ] Fix the top two drop-offs found in week 2 — this is the week's engineering work
- [ ] Publish 2 more dogfood receipts; by now grove's blog should be ~20 posts deep
- [ ] Turn the three best founding-user quotes into a landing-page testimonial row
- [ ] Second wave: 20 DMs/day to the remaining list, now with social proof to point at
- [ ] **Line up the launch, don't spam it:** DM ~30 people who've engaged with the build-in-public posts and ask them directly to look on Tuesday. Do not mass-message strangers, and do not ask for upvotes — ask for a look.
- [ ] Finish PH gallery + demo video; schedule for 00:01 PT Tue 18 Aug
- [ ] Write the Show HN post — technical angle (the manager agent and why it rejects 82%), not the marketing angle

**Exit criteria:** 25 founding users, 3 testimonials live on the site, PH assets done.

### Week 4 · 18 Aug – 24 Aug — Launch

**Tue 18 Aug — Product Hunt**
- 00:01 PT go live; first comment is the founder story, not a feature list
- Announce on X and LinkedIn at 06:00 PT with the oveners chart as the image
- Answer every PH comment within 15 minutes, all day
- Post to r/SaaS, r/indiehackers, r/Entrepreneur — different framing per sub, none of them a copy-paste

**Wed 19 Aug — Show HN**, separate day so it doesn't compete with PH.
Expect harsh comments about AI content; the 82% rejection stat *is* the answer,
and engaging honestly with skeptics is worth more than the upvotes.

**Thu–Mon** — ship a "what launch day actually looked like" post with real
numbers (traffic, signups, revenue, what broke). It performs, and it restocks the
build-in-public well for September.

**Exit criteria:** 100+ signups, 10+ paid, and — more important than either — a
written list of the objections that came up most, which becomes September's copy.

---

## 6. Paste-ready copy

**X pinned post**
> I built an AI that writes blog posts.
>
> Then I built a second one whose only job is to reject them.
>
> It kills 8 out of 10 first drafts.
>
> That's the entire product. Everyone else sells volume. Turns out what founders
> actually want is something that won't embarrass them.

**Cold DM (no pitch — this matters)**
> Hey [name] — saw [specific thing they shipped]. I'm doing free SEO teardowns
> for solo founders this month: 3 concrete gaps, 10 minutes of my time, nothing
> to buy. Want one? Happy to just send it over.

**Product Hunt first comment (skeleton)**
> I run a small product called Oven AI. It had a blog with nothing on it for a
> year, because I'd rather ship than write, and every AI writing tool I tried
> produced things I was embarrassed to put my name on.
>
> So grove has two agents instead of one. The first writes. The second reviews,
> scores 0–100, and sends it back. It rejects 8 out of 10 first drafts — including
> plenty I'd have shipped.
>
> On my own site: 36 posts over 8 weeks, search clicks from ~9/week to ~24/week,
> average position 14 → 10. One site, small numbers, and I'm not going to
> pretend it's more than that. [chart]
>
> $29/mo. Connect a domain, or drop one script tag into whatever you already
> have. Ask me anything — especially the skeptical questions about AI content,
> I've got opinions.

**Landing page testimonial ask (send at day 14 of a founding account)**
> Quick one — would you be up for a sentence about what grove's done for you so
> far, and permission to screenshot your Search Console before/after? Happy to
> link back to your site.

---

## 7. What to measure

Weekly, in one place. Vanity metrics excluded on purpose.

| Metric | Now | Target 25 Aug |
|---|---|---|
| Accounts that generated ≥1 post | 1 | 60 |
| **Activation rate** (signup → first post) | **0%** | **50%** |
| Paying customers | 0 | 10 |
| grove's own published posts | 0 | 25 |
| grove's own search clicks / week | 0 | 25 |
| Testimonials with real numbers | 0 | 5 |

Activation rate is the one that matters. If it's below 40% at the end of week 2,
stop all promotion and fix onboarding — driving traffic into a funnel that
converts at zero is the most expensive mistake available in the next month.
