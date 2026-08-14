# Grove agent architecture

Grove is a four-layer agent loop that runs continuously per domain:

```
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
        ▼                                                      │
  1. STRATEGY  ────►  2. GENERATION  ────►  3. MANAGER  ────►  4. ANALYTICS
   (monthly plan)     (writer pipeline)     (evaluator +       (post_events
        ▲                                   rewrite loop)       aggregated)
        │                                                      │
        └──────────────────────────────────────────────────────┘
                      monthly strategy review

        AGENT CONTEXT (markdown working memory, per domain)
        plan_md ◄── rebuilt on every build/revision
        progress_md ◄── weekly cron appends one compact entry
             ▲                    │
             │                    ▼
        PLAN CHAT (owner ⇄ strategist, cost-breakered)
```

## 0. Agent context (`lib/strategy/context.ts` + `context-store.ts`)

The loop's working memory is two small markdown docs per domain
(`agent_context` table, migration 0017):

- **`plan_md`** — the active plan as a ~500-token memo (month heading, goals
  with KPI targets, pillars, week-by-week direction, dated slots). Rebuilt by
  `savePlanContext` whenever a strategy is created or revised.
- **`progress_md`** — a rolling weekly log. Every Monday the weekly cron
  appends one two-line entry (shipped x/y planned · reads + trend ·
  conversions · organic share · top post) and trims to the newest 12 entries,
  so prompt cost stays flat forever while the strategist still sees ~3 months
  of season history.

Any LLM step that needs "where are we and how is it going" reads these docs
instead of re-serializing strategy/report JSON — that's the token-efficiency
contract. `horizons()` derives the owner-facing **this month / this week /
today** answer from the plan alone (no LLM), rendered at the top of
`/dashboard/strategy`.

## 0b. Plan chat (`lib/strategy/plan-chat.ts`, `/api/strategy/chat`)

Owners steer the plan in plain language. The chat is fire-walled from the
loop so conversation can never multiply loop cost:

1. Deterministic triage splits messages into question | revision (no LLM).
2. **Questions** run on the fast model over the plan memo + progress log.
3. **Revisions** are ONE strategist-model call that edits the existing plan
   JSON surgically — no research, no keyword crawl, no report aggregation,
   no post regeneration. `mergeRevision` preserves publish dates on kept
   slots, restores locked slots (posts already drafted/live), and caps slot
   count at 2× the plan quota so a chat message can't silently double spend.
   The revised strategy replaces the active row (`source: 'revised'`);
   existing posts are re-linked so the scheduler doesn't duplicate slots.
4. Hard monthly caps (`PLAN_CHAT_LIMITS`: 40 messages, 8 revisions) are
   enforced by counting persisted `plan_chat_messages` rows.

## 1. Strategy layer (`lib/strategy/`)

Per domain, per month, Grove produces a `strategies` row:

```ts
type Strategy = {
  month: string;                // "2026-06"
  source: 'inferred' | 'interview' | 'mixed' | 'revised';
  goals: Goal[];                // 2–4 measurable goals
  kpis: KPI[];                  // numeric targets that map to events
  pillars: Pillar[];            // 3–5 content pillars w/ funnel intent mix
  publishing_plan: PostSlot[];  // ~one row per post the plan wants this month
  direction?: Direction;        // owner-facing narrative: month line + weekly lines
  notes: string;                // what we'd change vs. last month
};
```

Planning runs on the strategy model tier (`strategyLlmCall`, default
`anthropic/claude-opus-4.7` on Replicate, `REPLICATE_STRATEGY_MODEL` to
override, graceful fallback to the workhorse model). It's affordable because
the tier is invoked at most a handful of times per domain per month: one
monthly build + capped chat revisions. Targets are **realistic but
optimistic** by prompt contract: first month sets modest cold-start numbers a
new blog can actually hit; later months anchor at 1.2–1.5× last month's
actuals (the report + progress log are both in the prompt).

Two construction paths, both supported:

- **`build.ts`** — pure-data path. Takes `site_profile`, prior-month `post_events` aggregate, and topic memory. Emits a strategy. Runs on a 1st-of-month cron (and any time a domain has no active strategy).
- **`interview.ts`** — owner-input path. Defines the question schema we ask the owner (goal, target metric, audience priority, off-limits topics, conversion offer). Their answers ride alongside the inferred data when `build.ts` runs.

Mixed mode is the default: we use interview answers when they exist, fall back to inferred values for anything the owner skipped.

## 2. Generation layer (`lib/pipeline/`)

Existing pipeline. Two changes:

- `topic-refiner.ts` reads the active strategy and pulls topics from the
  current month's publishing plan instead of guessing from raw keywords.
- The brief now carries `pillar_id` and `kpi_id` so downstream evaluators
  know what this article is *supposed* to do.

## 3. Manager layer (`lib/pipeline/manager.ts`)

A purely-LLM evaluator that gates publish. It receives:

- the active strategy,
- the brief (pillar, intent, KPI it serves),
- the draft (body, meta),
- the writer's self-check (validator output, citation count, etc.).

It scores the draft on a fixed rubric (`pass`/`fail` per rule with a 0-100
strategic-fit score) and outputs one of three actions:

- `approve` — persist as `review` or `scheduled` per domain settings,
- `rewrite` — call the writer ONCE more with manager's targeted notes,
- `reject` — kill the draft, mark `failed`, log why (rare; only when the
  topic itself is off-strategy).

After one rewrite loop, the manager makes a final call — no infinite loops.

Rubric is stored in `lib/pipeline/manager-rubric.ts` so non-engineers can
read it. Every evaluation persists to `post_evaluations`.

## 4. Analytics layer (`lib/analytics/`)

A first-party event stream — no third-party JS, GDPR-friendly by default.

Events go to `post_events`:

```
type | view | dwell | scroll_depth | outbound | exit | conversion
```

Source is the post page itself: a small inline `<script>` blob that:

- emits `view` on load (with `referrer`, `utm_*`, search `q`),
- emits `dwell` heartbeats every 15s while the tab is visible,
- emits `scroll_depth` at 25/50/75/100%,
- emits `outbound` when any anchor leading off-host is clicked,
- emits `exit` via `navigator.sendBeacon` on `pagehide`,
- emits `conversion` when a `data-conv` element is clicked.

Aggregation runs in `lib/analytics/summarize.ts` and produces the report
the manager agent reads at month-end:

- per-pillar reads, dwell-median, scroll-completion, outbound-rate
- per-topic top performers / bottom performers
- per-marketing-intent conversion rate
- referrer top-10 (organic / social / direct / referral)
- search-query top-20 (where we have them)

## Feedback loop

Weekly (Monday cron): per-domain stats + plan pace → one compact entry
appended to `progress_md`. This is the loop's heartbeat between re-plans —
and the same numbers feed the owner's digest email.

The 1st-of-month cron runs in this order:

1. `summarize(domain, lastMonth)` → produces the report.
2. `build({ profile, interview, prevStrategy, report, progressMd })` → next
   month's strategy — the weekly log means the plan compounds on the season,
   not just month-end totals.
3. New strategy is persisted; old one stays for audit. `savePlanContext`
   rebuilds `plan_md`.
4. `publishing_plan` becomes the source of truth for the topic refiner.

Owner-initiated revisions (plan chat) slot into the same contract at any
point in the month: a revised strategy row becomes active, posts re-link,
and the next scheduler tick executes the updated plan.

Each step is independently re-runnable. The manager agent's prompts read
the strategy's `notes` field so it can hold the writer to the explicit
"this month we're moving away from X, into Y" pivot.

## 5. Distribution: where the articles are read

The loop above produces articles; three surfaces put them in front of readers,
and they differ only in who owns the markup.

| Surface | Who renders | Who owns the URL |
| --- | --- | --- |
| Hosted blog (`/b/{slug}`, CNAME'd host) | grove | grove, or the customer's CNAME |
| `public/embed.js` | grove, inside the customer's page | the customer's page, one URL |
| **MCP server** (`/api/mcp`) | **the customer's own build** | **the customer, one URL per article** |

The third exists for a site with a **thick content layer** — its own `/blog`
route, its own card components, its own MDX pipeline. It cannot use the embed
(the embed brings markup, and they already have markup), and it will not move
to a hosted blog. Its integration is "pull the article into MY layer", which
used to mean hand-writing a client against the embed API.

The MCP server makes that a thing their coding agent does: `describe_blog`
reports the state, `list_articles`/`get_article` hand over the content in the
shape their layer wants (mdx | md | html | json), `plan_sync` says what changed
since last time, `integration_kit` supplies the analytics beacon and canonical
tag, and `set_article_base` closes the loop by telling grove which URLs the
articles now live at.

That last tool is the part that matters to the loop rather than to the
integration. Layer 4 aggregates `post_events`, and layer 1 plans against them.
An article rendered on the customer's site with no beacon is invisible to the
strategy build; an article whose URL grove doesn't know keeps grove's mirror
canonical, so the two copies compete and the customer's ranks second. Both are
silent, which is why the server states them in `instructions` at handshake time
rather than leaving them to a tool description nobody may call.

Auth is one key per domain (`mcp_keys`, 0035), sha256-stored and shown once.
Every query is scoped to the row that key resolved to — no tool accepts a
domain id — so the blast radius of a leaked key is one blog, and the only write
it can make is fenced to that blog's own hostname.

## Where this lives

- `supabase/migrations/0005_agentic.sql` — schema for `strategies`, `post_evaluations`, `post_events`.
- `supabase/migrations/0017_agent_context.sql` — `agent_context`, `plan_chat_messages`, `strategies.direction`.
- `lib/strategy/build.ts`, `lib/strategy/interview.ts`, `lib/strategy/review.ts` — strategy code.
- `lib/strategy/context.ts`, `lib/strategy/context-store.ts` — markdown working memory + horizons.
- `lib/strategy/plan-chat.ts`, `app/api/strategy/chat/route.ts` — owner plan chat (triage / revise / caps).
- `lib/pipeline/manager.ts`, `lib/pipeline/manager-rubric.ts` — evaluator.
- `lib/analytics/track.ts`, `lib/analytics/summarize.ts` — analytics.
- `app/api/track/route.ts` — public ingest endpoint.
- `app/b/[slug]/[post]/page.tsx` — inline tracker beacon.
- `app/api/cron/strategy/route.ts` — the loop. Hourly, ONE domain per
  invocation: planning needs the whole function to itself (see the route's
  docstring for why sharing a tick silently demoted it to the workhorse model).
- `app/api/cron/weekly-digest/route.ts` — weekly progress heartbeat + owner digest.
- `lib/mcp/` + `app/api/mcp/` — the MCP server: `protocol.ts` (JSON-RPC /
  Streamable HTTP envelope), `tools.ts` (catalog + prompts + resources),
  `server.ts` (handlers), `format.ts` (checksum, frontmatter, MDX escaping),
  `sync.ts` (the re-sync plan), `keys.ts` (mint/hash/read a key).
- `supabase/migrations/0035_mcp_keys.sql` — per-domain API keys for it.

All four layers are independent enough to evolve separately; the strategy
record is the contract between them.
