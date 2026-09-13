-- ─────────────────────────────────────────────────────────────
-- 0041_keyword_candidates.sql
-- Every keyword grove has ever considered for a domain, and what became of it.
--
-- WHAT IS BROKEN TODAY. `gatherKeywordDemand` runs fresh each month, its
-- results are flattened into a prompt string by `formatDemandForPrompt`, and
-- every candidate the strategist did not pick evaporates. Not archived —
-- never written down at all. So grove:
--
--   * re-derives, and re-proposes, the same rejected phrases every month;
--   * cannot say why a keyword was skipped, to the owner or to itself;
--   * cannot detect two slots quietly targeting the same intent; and
--   * cannot answer the one question that would validate the whole demand
--     model — "of the keywords we chose, which actually earned impressions?"
--
-- That last one is the reason to build this now. grove already owns the
-- outcomes (gsc_metrics, gsc_page_queries) but has never recorded the INPUT,
-- so half of the join has always been missing. No amount of Search Console
-- data can backtest a selection nobody wrote down.
--
-- WHAT MAKES THIS AN ASSET RATHER THAN A GRAVEYARD. Only the outcome columns.
-- A pool of phrases with nothing attached is landfill that grows monthly; the
-- same pool joined to post_id and then to the queries that post actually ranks
-- for is a measurement of whether the demand source works. Anything added here
-- later should be held to that test: does it help decide, or explain, or
-- measure? If not, it does not belong.
--
-- WHY THE METRIC COLUMNS ARE NULLABLE, AND WHY THAT IS THE POINT. Google
-- Autocomplete — grove's only candidate source today — carries no volume and
-- no difficulty, and cannot be made to. Rows arriving with both null are not a
-- data-quality defect to clean up; they are the measurement of the gap this
-- table exists to close. When a source starts filling them, the improvement is
-- visible as a column going from null to populated, per source, over time.
--
-- REJECTION IS A SNAPSHOT, NOT A VERDICT. Difficulty is a property of a
-- keyword AND a domain: KD 35 is out of reach for a three-week-old blog and
-- routine for the same blog two years on. So a rejected row keeps its reason
-- and its `metrics_at`, and re-screening one whose metrics have gone stale is
-- expected behaviour, not a bug. Nothing here is a permanent exclusion list —
-- the only permanent thing is the dedupe guarantee below.
--
-- SAFE ON ARRIVAL. A new table with no writer, no change to any existing
-- table, no backfill. This repo has shipped a migration to production without
-- anyone running db:push (see 0029), so arriving ahead of its code must be a
-- no-op — and here it is: until the planner writes to it, this is an empty
-- table and every existing behaviour is byte-identical.
--
-- RLS: owner reads their own rows, service role writes. Same model as
-- gsc_page_queries (0032), and deliberately NOT the service-role-only shape of
-- outreach_prospects (0035) or beta_coupons (0033) — those hold operator data,
-- whereas "here are the 340 keywords we considered for your site and the 12 we
-- chose" is an answer the customer is owed.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.keyword_candidates (
  id              uuid primary key default gen_random_uuid(),
  domain_id       uuid not null references public.domains(id) on delete cascade,

  -- ── the phrase ───────────────────────────────────────────────────────────
  -- Stored as displayed; deduped case-insensitively by the unique index below.
  keyword         text not null,
  -- The domain's publication language when this was gathered. A domain has one
  -- language, so this is a property of the row rather than part of its key —
  -- it records what the phrase was gathered AS, which matters when a domain's
  -- language changes and the old pool stops being relevant.
  lang            text not null default 'en',

  -- ── where it came from ───────────────────────────────────────────────────
  -- 'gsc' is the strongest source: a query the domain ALREADY earns
  -- impressions on is demand that needs no modelling at all.
  source          text not null,
  -- The seed phrase that produced it, so a source's yield can be traced back
  -- to the seed — the failure seeds.ts diagnosed (marketing copy as a seed
  -- returning zero) is invisible without this.
  seed            text,

  -- ── what we know about it (null = this source could not say) ─────────────
  volume          int,
  difficulty      int,                 -- 0-100, KD-style: chance of top-10
  cpc             numeric(10, 2),
  intent          text,
  -- The ordinal autocomplete proxy from rankSuggestions. Kept separate from
  -- `volume` on purpose: it is a rank accumulated across variant lists, not a
  -- count of searches, and conflating the two would let a confounded heuristic
  -- masquerade as measured demand.
  demand_score    int,
  -- When the metrics above were fetched. They are bought and they decay; a
  -- difficulty from eleven months ago should not silently gate this month's
  -- plan.
  metrics_at      timestamptz,

  -- ── what we decided ──────────────────────────────────────────────────────
  -- new: known, never acted on. planned: assigned to a strategy slot.
  -- published: that slot produced a live post. rejected: screened out, with a
  -- reason, re-screenable once metrics_at goes stale.
  status          text not null default 'new',
  strategy_id     uuid references public.strategies(id) on delete set null,
  slot_id         text,                -- matches posts.slot_id (text, not uuid)
  post_id         uuid references public.posts(id) on delete set null,
  chosen_at       timestamptz,
  rejected_reason text,

  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

-- Checks as plain text + CHECK rather than enums, so widening any vocabulary
-- stays a one-line migration instead of an ALTER TYPE (same reasoning as
-- domains.language in 0037).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'keyword_candidates_lang_check') then
    alter table public.keyword_candidates
      add constraint keyword_candidates_lang_check
      check (lang in ('en', 'ko', 'es', 'zh'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'keyword_candidates_source_check') then
    alter table public.keyword_candidates
      add constraint keyword_candidates_source_check
      check (source in ('autocomplete', 'dataforseo', 'gsc', 'related', 'manual'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'keyword_candidates_status_check') then
    alter table public.keyword_candidates
      add constraint keyword_candidates_status_check
      check (status in ('new', 'planned', 'published', 'rejected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'keyword_candidates_intent_check') then
    alter table public.keyword_candidates
      add constraint keyword_candidates_intent_check
      check (intent is null or intent in ('informational', 'commercial', 'transactional', 'navigational'));
  end if;

  -- A difficulty outside 0-100 means a vendor changed its scale or a parser
  -- read the wrong field. Better to reject the write than to screen against it.
  if not exists (select 1 from pg_constraint where conname = 'keyword_candidates_difficulty_check') then
    alter table public.keyword_candidates
      add constraint keyword_candidates_difficulty_check
      check (difficulty is null or (difficulty between 0 and 100));
  end if;
end $$;

-- THE DEDUPE GUARANTEE: one row per phrase per domain, forever. This is what
-- stops the planner re-proposing what it already rejected, and it is why a
-- month's gather is an upsert rather than an insert. Case-insensitive because
-- "SEO 전략" and "seo 전략" are one keyword, and Google treats them as one.
-- NOT scoped by language: a domain has exactly one publication language, so a
-- second row differing only in `lang` would be the same keyword twice.
create unique index if not exists keyword_candidates_domain_keyword_key
  on public.keyword_candidates (domain_id, lower(keyword));

-- The planning read: "unused candidates for this domain, easiest first, then
-- by demand." Partial on status='new' because that is the only slice the
-- planner ever scans, and it stays small while the table grows.
create index if not exists keyword_candidates_planning_idx
  on public.keyword_candidates (domain_id, difficulty nulls last, volume desc nulls last)
  where status = 'new';

-- The backtest join: candidate -> post -> gsc_page_queries(post_id, query).
-- Answers "did the post we wrote for this keyword actually rank for it, or for
-- something else entirely?" — which is the question that validates or kills
-- whichever demand source produced the row.
create index if not exists keyword_candidates_post_idx
  on public.keyword_candidates (post_id)
  where post_id is not null;

comment on table public.keyword_candidates is
  'Every keyword considered for a domain and what became of it. Unique on (domain_id, lower(keyword)) so nothing is proposed twice. Null volume/difficulty means the source could not supply them (autocomplete never can) — that nullability is the measurement of the data gap, not a defect. Joins through post_id to gsc_page_queries to backtest whether a chosen keyword actually earned impressions.';

comment on column public.keyword_candidates.demand_score is
  'Ordinal autocomplete proxy from rankSuggestions (sum of n-i across variant lists). Deliberately NOT volume: it is confounded by seed-list redundancy and is not a count of searches.';

comment on column public.keyword_candidates.metrics_at is
  'When volume/difficulty/cpc were last fetched. Null means never. Metrics are purchased and decay; a rejection older than its metrics should be re-screened rather than trusted.';

alter table public.keyword_candidates enable row level security;

-- Owner reads their own rows; the planner and screening cron write through the
-- service role, which bypasses RLS — same model as gsc_page_queries (0032).
--
-- Guarded, because `create policy` has no `if not exists` form and this file
-- must survive being applied twice. That is not hypothetical here: applying a
-- migration through the Supabase MCP records it under a generated timestamp
-- version, the CLI then reads the repo's number as unapplied, and `db push`
-- re-runs the whole file (0035 and 0036 both hit this). Everything else in
-- this migration is `if not exists`; without this block the re-run would fail
-- on the last statement, after having already done its work.
do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'keyword_candidates'
      and p.polname = 'own keyword candidates'
  ) then
    create policy "own keyword candidates" on public.keyword_candidates
      for all using (
        exists (
          select 1 from public.domains d
          where d.id = keyword_candidates.domain_id and d.user_id = auth.uid()
        )
      );
  end if;
end $$;
