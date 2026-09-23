/**
 * Reads and writes for `keyword_candidates` (migration 0041).
 *
 * The table turns the planner's amnesia into a record: every keyword grove has
 * considered for a domain, what each source could say about it, and what became
 * of it. This module is the only thing that touches it, so the query shapes
 * stay in one place — same split as lib/feedback.ts (vocabulary) and
 * lib/feedback-store.ts (queries).
 *
 * FAIL-SOFT THROUGHOUT. Losing a month's candidate bookkeeping must never cost
 * the month's plan: the planner is the product, this is the ledger. Every
 * function swallows its errors and returns a neutral value, and callers are
 * written so that a total outage here is indistinguishable from the behaviour
 * before the table existed.
 */
import { supabaseAdmin } from '../supabase/admin';
import type { ScoredKeyword } from '../keywords/opportunity';
import type { LangCode } from '../language';
import { assess } from '../keywords/difficulty';

/** A keyword already spoken for. Re-proposing these is churn, not planning. */
export type Exclusion = { keyword: string; status: string };

export type CandidateRow = {
  domain_id: string;
  keyword: string;
  lang: LangCode;
  source: string;
  seed: string | null;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  demand_score: number | null;
  metrics_at: string | null;
};

/**
 * Shape one candidate for the table.
 *
 * `metrics_at` is stamped only when a metric actually arrived. A row whose
 * volume and difficulty are both null has not been measured, and dating it
 * would make a never-measured keyword look freshly screened — which is exactly
 * the signal `metrics_at` exists to carry (see 0041: rejection is a snapshot,
 * and re-screening depends on knowing when the numbers are from).
 */
export function candidateRow(
  domainId: string,
  kw: ScoredKeyword,
  lang: LangCode,
  seed: string | null,
  now: () => string = () => new Date().toISOString(),
): CandidateRow {
  const measured = kw.volume != null || kw.difficulty != null;
  return {
    domain_id: domainId,
    keyword: kw.keyword.trim(),
    lang,
    source: kw.source === 'dataforseo' || kw.source === 'gsc' || kw.source === 'related' || kw.source === 'manual'
      ? kw.source
      : 'autocomplete',
    seed,
    volume: kw.volume,
    // The PROVIDER's KD, not grove's difficulty: grove's is recomputed from
    // fresh authority data every build (see withSerpAuthority), and a stored
    // copy of it would be indistinguishable from the raw KD older rows hold.
    difficulty: kw.providerKd !== undefined ? kw.providerKd : kw.difficulty,
    intent: kw.intent,
    demand_score: null,
    metrics_at: measured ? now() : null,
  };
}

/**
 * Split incoming candidates against what the domain already has.
 *
 * Pure, so the decision is testable without a database — and it is a real
 * decision: the table is unique on (domain_id, lower(keyword)), so an insert
 * of something already present would be rejected, and blindly updating every
 * row every month would destroy `first_seen`, the only column that says how
 * long grove has been looking at a keyword.
 */
export function diffCandidates<T extends { keyword: string }>(
  existing: Iterable<string>,
  incoming: T[],
): { toInsert: T[]; toTouch: string[] } {
  const have = new Set([...existing].map((k) => k.toLowerCase()));
  const seen = new Set<string>();
  const toInsert: T[] = [];
  const toTouch: string[] = [];

  for (const c of incoming) {
    const key = c.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;   // the batch can repeat a phrase
    seen.add(key);
    if (have.has(key)) toTouch.push(c.keyword.trim());
    else toInsert.push(c);
  }
  return { toInsert, toTouch };
}

/**
 * Which previously-seen keywords this month should skip.
 *
 * `published` and `planned` are permanent: writing the same target twice is
 * cannibalisation, where two of your own pages split the signal for one query.
 *
 * `rejected` is deliberately NOT permanent. Difficulty is a property of a
 * keyword AND a domain, so a KD the site could not touch in month 1 is
 * ordinary by month 18 — a permanent rejection list would quietly cap the
 * blog at whatever its authority was on day one. A rejection expires with its
 * metrics, and the keyword returns to the pool to be screened against the
 * domain grove has now.
 */
export function shouldExclude(
  row: { status: string; metrics_at: string | null },
  now: Date,
  rejectionTtlDays: number,
): boolean {
  if (row.status === 'published' || row.status === 'planned') return true;
  if (row.status !== 'rejected') return false;
  if (!row.metrics_at) return false;             // never measured — re-screen it
  const age = (now.getTime() - new Date(row.metrics_at).getTime()) / 86_400_000;
  return Number.isFinite(age) && age < rejectionTtlDays;
}

/** Record everything considered. Returns how many rows were new. */
export async function recordCandidates(
  domainId: string,
  cands: ScoredKeyword[],
  opts: { lang: LangCode; seed?: string | null },
): Promise<number> {
  if (!domainId || !cands.length) return 0;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('keyword_candidates')
      .select('keyword')
      .eq('domain_id', domainId);

    const { toInsert, toTouch } = diffCandidates(
      (data ?? []).map((r: any) => String(r.keyword ?? '')),
      cands,
    );

    if (toInsert.length) {
      // Chunked: a month's research can be several hundred rows and a single
      // oversized request is the kind of thing that fails only in production.
      for (let i = 0; i < toInsert.length; i += 200) {
        const rows = toInsert.slice(i, i + 200).map((k) => candidateRow(domainId, k, opts.lang, opts.seed ?? null));
        // A concurrent planner run can insert the same phrase between our read
        // and our write. The unique index rejects it, which is correct; losing
        // the rest of the chunk to that is not, so each chunk stands alone.
        await sb.from('keyword_candidates').insert(rows);
      }
    }

    if (toTouch.length) {
      await sb
        .from('keyword_candidates')
        .update({ last_seen: new Date().toISOString() })
        .eq('domain_id', domainId)
        .in('keyword', toTouch.slice(0, 500));
    }

    return toInsert.length;
  } catch {
    return 0;   // the ledger is not worth the month's plan
  }
}

/**
 * Keywords this month must not propose again. [] on any failure, which reads
 * as "nothing is excluded" — the pre-table behaviour.
 */
export async function excludedKeywords(
  domainId: string,
  opts: { rejectionTtlDays?: number } = {},
): Promise<string[]> {
  if (!domainId) return [];
  const ttl = opts.rejectionTtlDays ?? 90;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('keyword_candidates')
      .select('keyword, status, metrics_at')
      .eq('domain_id', domainId)
      .in('status', ['planned', 'published', 'rejected']);

    const now = new Date();
    return (data ?? [])
      .filter((r: any) => shouldExclude({ status: String(r.status), metrics_at: r.metrics_at ?? null }, now, ttl))
      .map((r: any) => String(r.keyword));
  } catch {
    return [];
  }
}

/**
 * After a plan is stored, mark the keywords it committed to.
 *
 * Runs from the caller that owns the strategy row, because `strategy_id` does
 * not exist until that insert returns. Matching is case-insensitive via
 * `ilike` to line up with the table's `lower(keyword)` uniqueness — a plain
 * `eq` would miss a pillar the model title-cased on its way through the LLM.
 */
export async function markPlanned(
  domainId: string,
  strategyId: string | null,
  slots: { id?: string; target_keyword?: string }[],
): Promise<number> {
  if (!domainId || !slots?.length) return 0;
  let n = 0;
  try {
    const sb = supabaseAdmin();
    const now = new Date().toISOString();
    for (const slot of slots) {
      const kw = (slot.target_keyword ?? '').trim();
      if (!kw) continue;
      const { error } = await sb
        .from('keyword_candidates')
        .update({ status: 'planned', strategy_id: strategyId, slot_id: slot.id ?? null, chosen_at: now })
        .eq('domain_id', domainId)
        .ilike('keyword', kw);
      if (!error) n++;
    }
  } catch { /* the ledger is not worth the month's plan */ }
  return n;
}

/**
 * Give a replaced plan's keywords back to the pool.
 *
 * `markPlanned` is permanent by design — a keyword in the live plan must not
 * be proposed twice. But a plan that is REPLACED (the owner re-answered the
 * interview, the refresh pass rebuilt it, someone deactivated it by hand)
 * is not live any more, and its keywords stayed `planned` regardless. Each
 * rebuild then excluded the previous plan's best phrases as "already
 * planned", and grove's own plan went 10 slots → 9 → 2 across three rebuilds
 * on 2026-09-13 while the phrases it should have used sat in the ledger,
 * marked as taken by rows nobody was reading. Published stays published:
 * that article exists whatever plan it came from.
 */
export async function releasePlanned(domainId: string, strategyIds: string[]): Promise<number> {
  const ids = strategyIds.filter(Boolean);
  if (!domainId || !ids.length) return 0;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from('keyword_candidates')
      .update({ status: 'new', strategy_id: null, slot_id: null, chosen_at: null })
      .eq('domain_id', domainId)
      .eq('status', 'planned')
      .in('strategy_id', ids)
      .select('id');
    return error ? 0 : (data?.length ?? 0);
  } catch {
    return 0;   // the ledger is not worth the month's plan
  }
}

/**
 * The measured, unclaimed candidates a domain already has on file.
 *
 * The ledger was written to be READ at planning time — 0041's planning index
 * is literally "unused candidates for this domain, easiest first" — and
 * nothing read it. Each month's pool was only what that month's research
 * returned, so a phrase measured in July at 3,600/mo and never picked was
 * gone in August unless the API happened to return it again. This hands the
 * planner everything the domain has already paid to measure; the relevance
 * screen and the ledger's rejections then converge it toward a clean pool
 * rather than re-discovering the same junk monthly. `metrics_at` bounds how
 * stale a number may be — purchased metrics decay (see 0041).
 */
export async function candidatePool(
  domainId: string,
  lang: LangCode,
  opts: { maxAgeDays?: number; limit?: number } = {},
): Promise<ScoredKeyword[]> {
  if (!domainId) return [];
  try {
    const sb = supabaseAdmin();
    const since = new Date(Date.now() - (opts.maxAgeDays ?? 120) * 86_400_000).toISOString();
    const { data } = await sb
      .from('keyword_candidates')
      .select('keyword, source, volume, difficulty, intent')
      .eq('domain_id', domainId)
      .eq('lang', lang)
      .eq('status', 'new')
      .not('volume', 'is', null)
      .gte('metrics_at', since)
      .order('volume', { ascending: false })
      .limit(opts.limit ?? 400);
    // `difficulty` on file is the provider's raw KD. Read back as that, and
    // assessed as kd_only until withSerpAuthority re-measures it — so a stored
    // KD 0 is "unknown", never "easy". `serp` is left undefined on purpose:
    // it is what marks the row as not yet re-measured this run.
    return (data ?? []).map((r: any) => assess({
      keyword: String(r.keyword),
      source: String(r.source ?? 'dataforseo'),
      volume: r.volume ?? null,
      difficulty: r.difficulty ?? null,
      providerKd: r.difficulty ?? null,
      intent: (r.intent ?? null) as ScoredKeyword['intent'],
    }));
  } catch {
    return [];
  }
}

/**
 * Fresh research first, the ledger for whatever it didn't return. Pure, so
 * the precedence is testable: this month's metrics win over last month's for
 * the same phrase, and nothing is listed twice.
 */
export function mergePool(fresh: ScoredKeyword[], onFile: ScoredKeyword[]): ScoredKeyword[] {
  const seen = new Set<string>();
  const out: ScoredKeyword[] = [];
  for (const k of [...fresh, ...onFile]) {
    const key = k.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/**
 * Record why a screened-out keyword lost — the other half of "what did we
 * pass over". Only rows still `new` are touched: a keyword already planned
 * or published has an outcome, and a fresh rejection must not overwrite it.
 *
 * A rejection is a snapshot (see 0041): `metrics_at` stays as it was, so a
 * measured rejection expires with its metrics and is re-screened, while an
 * unmeasured one is re-screened immediately. For `off_topic` that means the
 * model gets asked again in a quarter — cheap, and it keeps the ledger
 * honest about being a decision log rather than a blocklist. Fail-soft.
 */
export async function markRejected(
  domainId: string,
  keywords: string[],
  reason: string,
): Promise<number> {
  const list = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  if (!domainId || !list.length) return 0;
  let n = 0;
  try {
    const sb = supabaseAdmin();
    for (let i = 0; i < list.length; i += 100) {
      const { data, error } = await sb
        .from('keyword_candidates')
        .update({ status: 'rejected', rejected_reason: reason })
        .eq('domain_id', domainId)
        .eq('status', 'new')
        .in('keyword', list.slice(i, i + 100))
        .select('id');
      if (!error) n += data?.length ?? 0;
    }
  } catch { /* the ledger is not worth the month's plan */ }
  return n;
}

/**
 * The rows that belong to one published post, or null when there are none.
 *
 * Pure, and it exists because of a bug worth stating: `slot_id` is NOT unique.
 * It is a position within one month's plan ("slot-3"), so every strategy a
 * domain has ever had contains a slot-3. Matching a candidate on
 * (domain_id, slot_id) alone would mark this month's article as the outcome of
 * a keyword chosen last March. `strategy_id` is what disambiguates, so all
 * three are required and a post missing any of them has no candidate to mark —
 * which is the correct answer for a hand-written post from the Write page,
 * since it never came from a plan.
 */
export function candidateMatch(
  post: { domain_id?: string | null; slot_id?: string | null; strategy_id?: string | null } | null | undefined,
): { domain_id: string; slot_id: string; strategy_id: string } | null {
  const domain_id = post?.domain_id ?? '';
  const slot_id = post?.slot_id ?? '';
  const strategy_id = post?.strategy_id ?? '';
  if (!domain_id || !slot_id || !strategy_id) return null;
  return { domain_id, slot_id, strategy_id };
}

/**
 * Close the loop: a slot's keyword becomes `published` and gains its post_id,
 * which is the join the whole backtest runs through
 * (candidate -> post -> gsc_page_queries -> the queries it actually earned).
 *
 * Takes only a post id and resolves the rest itself, because there are two
 * publish paths — the manual approve and the scheduler cron — and threading
 * three identifiers through both is how they drift apart. approve.ts exists
 * for exactly that reason; this follows it.
 *
 * Fail-soft and idempotent: re-publishing the same post rewrites the same row.
 */
export async function markPublishedForPost(postId: string): Promise<boolean> {
  if (!postId) return false;
  try {
    const sb = supabaseAdmin();
    const { data: post } = await sb
      .from('posts')
      .select('domain_id, slot_id, strategy_id')
      .eq('id', postId)
      .maybeSingle();

    const match = candidateMatch(post as any);
    if (!match) return false;

    const { error } = await sb
      .from('keyword_candidates')
      .update({ status: 'published', post_id: postId })
      .eq('domain_id', match.domain_id)
      .eq('strategy_id', match.strategy_id)
      .eq('slot_id', match.slot_id);
    return !error;
  } catch {
    return false;   // the ledger is never worth failing a publish that succeeded
  }
}
