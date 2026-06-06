# Grove agent architecture

Grove is a four-layer agent loop that runs continuously per domain:

```
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
        ▼                                                      │
  1. STRATEGY  ────►  2. GENERATION  ────►  3. MANAGER  ────►  4. ANALYTICS
   (monthly plan)     (writer pipeline)     (evaluator +       (post_events
                                            rewrite loop)       aggregated)
        ▲                                                      │
        └──────────────────────────────────────────────────────┘
                      monthly strategy review
```

## 1. Strategy layer (`lib/strategy/`)

Per domain, per month, Grove produces a `strategies` row:

```ts
type Strategy = {
  month: string;                // "2026-06"
  source: 'inferred' | 'interview' | 'mixed';
  goals: Goal[];                // 2–4 measurable goals
  kpis: KPI[];                  // numeric targets that map to events
  pillars: Pillar[];            // 3–5 content pillars w/ funnel intent mix
  publishing_plan: PostSlot[];  // ~one row per post the plan wants this month
  notes: string;                // what we'd change vs. last month
};
```

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

The 1st-of-month cron runs in this order:

1. `summarize(domain, lastMonth)` → produces the report.
2. `build({ profile, interview, prevStrategy, report })` → next month's strategy.
3. New strategy is persisted; old one stays for audit.
4. `publishing_plan` becomes the source of truth for the topic refiner.

Each step is independently re-runnable. The manager agent's prompts read
the strategy's `notes` field so it can hold the writer to the explicit
"this month we're moving away from X, into Y" pivot.

## Where this lives

- `supabase/migrations/0005_agentic.sql` — schema for `strategies`, `post_evaluations`, `post_events`.
- `lib/strategy/build.ts`, `lib/strategy/interview.ts`, `lib/strategy/review.ts` — strategy code.
- `lib/pipeline/manager.ts`, `lib/pipeline/manager-rubric.ts` — evaluator.
- `lib/analytics/track.ts`, `lib/analytics/summarize.ts` — analytics.
- `app/api/track/route.ts` — public ingest endpoint.
- `app/b/[slug]/[post]/page.tsx` — inline tracker beacon.
- `app/api/cron/monthly-strategy/route.ts` — the loop.

All four layers are independent enough to evolve separately; the strategy
record is the contract between them.
