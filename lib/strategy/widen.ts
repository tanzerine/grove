/**
 * Widening — what research does when it comes back thin.
 *
 * Before this, a thin pool had exactly one response: the CLUSTER RULE's "plan
 * FEWER slots". trygroveai.com's keyword ledger held 83 candidates, 5 of them
 * winnable, and its plans shrank to two slots, then to one — while the ledger
 * also held "byword ai alternative", the exact kind of target a young SaaS can
 * win, found by Autocomplete and never measured because the pool only ever
 * reads candidates that already carry volume. The research step had found it;
 * the next step could not see it.
 *
 * So when fewer winnable clusters survive screening than there are slots, one
 * more round runs before anyone settles for fewer:
 *   1. size the candidates already on file that were never measured (one
 *      keyword_overview call covers up to 700), and write the numbers back so
 *      next month's pool includes them without paying again;
 *   2. research the seeds the first round cut — the seed list is capped at 24,
 *      and buyer/customer seeds past their caps were never asked about at all.
 *
 * Bounded by wall clock: it runs only when enough is left that the strategy
 * call keeps its fallback. A thin pool is worth a cheaper planner; it is not
 * worth no plan.
 */
import { supabaseAdmin } from '../supabase/admin';
import type { ScoredKeyword } from '../keywords/opportunity';
import type { LangCode } from '../language';
import { isBrandQuery } from './seeds';

/**
 * Below this much remaining budget, widening is skipped. 75s fallback reserve
 * + 20s write-back (lib/llm.ts) + ~55s for one sizing call, a ten-seed Labs
 * round and a screening call over the new clusters.
 */
export const WIDEN_MIN_REMAINING_MS = 150_000;
export const WIDEN_SEED_LIMIT = 10;

export function needsWidening(winnableClusters: number, slots: number): boolean {
  return slots > 0 && winnableClusters < slots;
}

/** Seeds not already researched, not the brand, deduped, in priority order. */
export function widenSeeds(candidates: string[], used: string[], brands: string[], limit = WIDEN_SEED_LIMIT): string[] {
  const seen = new Set(used.map((s) => s.toLowerCase().trim()));
  const out: string[] = [];
  for (const raw of candidates) {
    const s = raw.trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k) || isBrandQuery(s, brands)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Candidates on file that were never measured — the ones candidatePool skips. */
export async function unmeasuredCandidates(
  domainId: string,
  lang: LangCode,
  brands: string[],
  limit = 200,
): Promise<string[]> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('keyword_candidates')
      .select('keyword')
      .eq('domain_id', domainId)
      .eq('lang', lang)
      .eq('status', 'new')
      .is('volume', null)
      .order('last_seen', { ascending: false })
      .limit(limit);
    return (data ?? [])
      .map((r: any) => String(r.keyword ?? '').trim())
      .filter((k) => k && !isBrandQuery(k, brands));
  } catch {
    return [];
  }
}

/**
 * Write measured numbers onto rows that already exist. recordCandidates only
 * inserts new phrases and touches last_seen on known ones, so a phrase sized
 * here would otherwise be measured again every month and never reach the pool.
 */
export async function recordMetrics(domainId: string, sized: ScoredKeyword[]): Promise<number> {
  const rows = sized.filter((k) => k.volume != null || k.difficulty != null);
  if (!domainId || !rows.length) return 0;
  try {
    const sb = supabaseAdmin();
    const at = new Date().toISOString();
    let n = 0;
    for (let i = 0; i < rows.length; i += 10) {
      const results = await Promise.all(rows.slice(i, i + 10).map((k) =>
        sb.from('keyword_candidates')
          .update({
            volume: k.volume, difficulty: k.difficulty, intent: k.intent ?? null,
            source: k.source || 'dataforseo', metrics_at: at,
          })
          .eq('domain_id', domainId)
          .eq('keyword', k.keyword)
          .is('volume', null)));
      n += results.filter((r) => !r.error).length;
    }
    return n;
  } catch {
    return 0;
  }
}
