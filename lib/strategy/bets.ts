/**
 * The bet ledger — what became of every keyword the strategist aimed at.
 *
 * Each planned slot is a bet: "this domain can rank for THIS target keyword".
 * Until this file, nothing ever settled one. The monthly report measures views,
 * dwell and conversions per post, which says whether readers liked an article
 * but not whether Google gave it the query it was written for. So the planner
 * could not tell "too hard for this domain" from "badly written" from "never
 * shown", and it re-planned from scratch every month: trygroveai.com's plans
 * went from brand keywords, to broad head terms, to keywords for a Disney show,
 * to a single slot on "topical authority" — each month naming a new cause,
 * none of them checked.
 *
 * Nothing new is stored. A bet is reconstructed from what is already on file:
 * posts.strategy_id + slot_id → that slot's target_keyword (and its cluster),
 * graded against the latest Search Console snapshot for the post's page
 * (gsc_metrics, dimension 'page') and the queries it earned (gsc_page_queries).
 * Both are a trailing 28-day window, so a verdict is "what Google is doing with
 * it now", which is the thing a plan has to react to.
 *
 * Grading and formatting are pure and tested; loadBets is the only I/O and is
 * fail-soft — a planner without its ledger plans exactly as it did before.
 */
import { supabaseAdmin } from '../supabase/admin';
import { titleTokens } from '../related-posts';
import { isBrandQuery } from './seeds';

/** Younger than this, a page has not had a fair chance to be ranked. */
export const MIN_AGE_DAYS = 28;

/** A query Google matched us to beyond this is a misfire, not a lead. */
const LEAD_MAX_POSITION = 30;

export type BetQuery = { query: string; impressions: number; clicks: number; position: number };

export type BetInput = {
  postId: string;
  title: string;
  publishedAt: string;
  targetKeyword: string;
  secondaryKeywords?: string[];
  /** The page's own totals in the latest snapshot; 0 when Google showed it for nothing. */
  pageImpressions: number;
  pageClicks: number;
  /** Every query the page earned in the latest snapshot. */
  queries: BetQuery[];
};

export type BetVerdict =
  | 'won'        // target cluster at position <= 10
  | 'close'      // 11-20
  | 'far'        // shown for the target, beyond 20
  | 'elsewhere'  // shown, but not for the target
  | 'unseen'     // not shown at all
  | 'brand'      // aimed at the business's own name
  | 'too_early';

export type Bet = {
  postId: string;
  title: string;
  targetKeyword: string;
  ageDays: number;
  verdict: BetVerdict;
  /** Impressions and weighted position for the queries that match the target. */
  target: { impressions: number; position: number } | null;
  pageImpressions: number;
  /** The page's best query when Google matched it to something else. */
  shownFor: BetQuery | null;
};

/**
 * Does a search query count toward a target? It must contain every content
 * word of the target or of one of the cluster's secondary phrases: "topical
 * authority seo" counts for "topical authority"; "seo tools" does not count for
 * "seo for solo founders". Word containment, not similarity — a query that
 * merely shares a topic is the `elsewhere` case, which is its own lesson.
 */
export function queryHitsTarget(query: string, targets: string[]): boolean {
  const q = titleTokens(query);
  return targets.some((t) => {
    const need = titleTokens(t);
    if (!need.size) return false;
    for (const w of need) if (!q.has(w)) return false;
    return true;
  });
}

export function gradeBet(b: BetInput, now: Date, brands: string[]): Bet {
  const ageDays = Math.floor((now.getTime() - new Date(b.publishedAt).getTime()) / 86_400_000);
  const targets = [b.targetKeyword, ...(b.secondaryKeywords ?? [])].filter(Boolean);
  const hits = b.queries.filter((q) => queryHitsTarget(q.query, targets));
  const impr = hits.reduce((a, q) => a + q.impressions, 0);
  const target = impr > 0
    ? { impressions: impr, position: round1(hits.reduce((a, q) => a + q.position * q.impressions, 0) / impr) }
    : null;
  // The page's best non-brand query: "shown for groveai instead" teaches nothing.
  const shownFor = target
    ? null
    : [...b.queries].filter((q) => !isBrandQuery(q.query, brands))
      .sort((x, y) => y.impressions - x.impressions)[0] ?? null;

  const verdict: BetVerdict =
    isBrandQuery(b.targetKeyword, brands) ? 'brand'
    : ageDays < MIN_AGE_DAYS ? 'too_early'
    : target ? (target.position <= 10 ? 'won' : target.position <= 20 ? 'close' : 'far')
    : b.pageImpressions > 0 ? 'elsewhere'
    : 'unseen';

  return {
    postId: b.postId,
    title: b.title,
    targetKeyword: b.targetKeyword,
    ageDays,
    verdict,
    target,
    pageImpressions: b.pageImpressions,
    shownFor,
  };
}

export function gradeBets(inputs: BetInput[], now: Date, brands: string[]): Bet[] {
  return inputs.map((b) => gradeBet(b, now, brands));
}

const ORDER: BetVerdict[] = ['won', 'close', 'elsewhere', 'far', 'unseen', 'brand'];
const LABEL: Record<BetVerdict, string> = {
  won: 'TOP 10', close: '11-20', elsewhere: 'OTHER QUERY', far: 'BEYOND 20',
  unseen: 'NOT SHOWN', brand: 'OWN NAME', too_early: 'TOO NEW',
};

/**
 * The planner's block. Leads with the scorecard and ends with what it implies,
 * because a list of rows alone gets skimmed — the conclusions are written out
 * so the model can't read a ledger of failures as a list of themes to continue.
 */
export function formatBetsForPrompt(bets: Bet[], opts: { asOf?: string | null; limit?: number } = {}): string {
  if (!bets.length) return '';
  const judged = bets.filter((b) => b.verdict !== 'too_early');
  const pending = bets.filter((b) => b.verdict === 'too_early');
  const count = (v: BetVerdict) => judged.filter((b) => b.verdict === v).length;

  const rows = [...judged]
    .sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.pageImpressions - a.pageImpressions)
    .slice(0, opts.limit ?? 30)
    .map((b) => {
      const what =
        b.verdict === 'won' || b.verdict === 'close' || b.verdict === 'far'
          ? `pos ${b.target!.position}, ${b.target!.impressions} impr`
          : b.verdict === 'elsewhere'
            ? b.shownFor
              ? `shown for "${b.shownFor.query}" (pos ${round1(b.shownFor.position)}) instead — never for its target`
              : `${b.pageImpressions} impr, none for its target`
            : b.verdict === 'unseen'
              ? `no impressions after ${b.ageDays} days`
              : 'aimed at the business\'s own name';
      return `  ${LABEL[b.verdict]}  "${b.targetKeyword}" → "${b.title.slice(0, 70)}" — ${what}`;
    });

  const reached = judged.filter((b) => b.verdict === 'won' || b.verdict === 'close');
  // Only a named query at a reachable position is a lead. "shown for
  // oliviacal.com at 45" is Google guessing, and an instruction to plan a slot
  // for it would be worse than no instruction.
  const leads = judged
    .map((b) => b.verdict === 'elsewhere' ? b.shownFor : null)
    .filter((q): q is BetQuery => !!q && q.position <= LEAD_MAX_POSITION);
  const implications = [
    '- Do not target any keyword above again, or a reworded version of it. A TOP 10 or 11-20 page already owns its query; a new article aimed there splits the signal between two of our own URLs.',
    reached.length
      ? `- These targets reached the top 20, which is the size of keyword this domain can win today: ${reached.map((b) => `"${b.targetKeyword}"`).join(', ')}. Choose targets at least as specific as these over broader ones, whatever the volume.`
      : judged.length
        ? '- None of these reached the top 20. This domain cannot yet win the kind of keyword it has been choosing: pick only the most specific, longest phrases on offer — the ones the fewest pages compete for — over anything broad, however low its KD or high its volume.'
        : '',
    leads.length
      ? `- Google matched our pages to these queries without being asked: ${leads.map((q) => `"${q.query}" (pos ${round1(q.position)})`).join(', ')}. That is demand this domain can already reach — each is a candidate for a slot of its own, not a rewrite of the page that surfaced it.`
      : '',
    count('brand')
      ? '- OWN NAME articles reached only people who already knew the business. Plan none this month.'
      : '',
  ].filter(Boolean);

  return [
    `WHAT WE ALREADY TRIED — every article planned here was a bet that this domain could rank for its target keyword. This is what Google did with each (Search Console, trailing 28 days${opts.asOf ? ` to ${opts.asOf}` : ''}). It is the only evidence of what THIS site can win; read it before choosing any target.`,
    `SCORECARD (${judged.length} old enough to judge): ${count('won')} top 10 · ${count('close')} at 11-20 · ${count('far')} beyond 20 · ${count('elsewhere')} shown only for other queries · ${count('unseen')} not shown at all · ${count('brand')} aimed at the business's own name.${pending.length ? ` ${pending.length} more under ${MIN_AGE_DAYS} days old.` : ''}`,
    ...rows,
    ...(pending.length
      ? [`  TOO NEW (don't re-target either): ${pending.slice(0, 15).map((b) => `"${b.targetKeyword}"`).join(', ')}`]
      : []),
    'WHAT THIS MEANS FOR THIS PLAN:',
    ...implications,
  ].join('\n');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Reconstruct and grade every settled-or-pending bet for a domain. Fail-soft:
 * any error returns an empty ledger, and the planner proceeds without it.
 */
export async function loadBets(
  domainId: string,
  brands: string[],
  now = new Date(),
): Promise<{ bets: Bet[]; asOf: string | null }> {
  try {
    const sb = supabaseAdmin();
    const { data: posts } = await sb
      .from('posts')
      .select('id, title, published_at, strategy_id, slot_id')
      .eq('domain_id', domainId)
      .eq('status', 'published')
      .not('strategy_id', 'is', null)
      .not('slot_id', 'is', null)
      .order('published_at', { ascending: false })
      .limit(200);
    if (!posts?.length) return { bets: [], asOf: null };

    const strategyIds = [...new Set(posts.map((p: any) => String(p.strategy_id)))];
    const { data: strategies } = await sb
      .from('strategies').select('id, publishing_plan').in('id', strategyIds);
    const slotOf = new Map<string, { target_keyword?: string; secondary_keywords?: string[] }>();
    for (const s of strategies ?? []) {
      for (const slot of ((s as any).publishing_plan ?? []) as any[]) {
        slotOf.set(`${(s as any).id}:${slot.id}`, slot);
      }
    }

    // One snapshot date for the whole ledger, so every verdict reads the same window.
    const { data: latest } = await sb
      .from('gsc_metrics').select('date')
      .eq('domain_id', domainId).eq('dimension', 'page')
      .order('date', { ascending: false }).limit(1).maybeSingle();
    const asOf: string | null = (latest as any)?.date ?? null;
    // No Search Console snapshot means no evidence, not "nothing was shown":
    // grading without one would call every article a failure.
    if (!asOf) return { bets: [], asOf: null };

    const postIds = posts.map((p: any) => String(p.id));
    const pageTotals = new Map<string, { impressions: number; clicks: number }>();
    const queriesOf = new Map<string, BetQuery[]>();
    {
      const [{ data: pages }, { data: pq }] = await Promise.all([
        sb.from('gsc_metrics').select('post_id, impressions, clicks')
          .eq('domain_id', domainId).eq('dimension', 'page').eq('date', asOf).in('post_id', postIds),
        sb.from('gsc_page_queries').select('post_id, query, impressions, clicks, position')
          .eq('domain_id', domainId).eq('date', asOf).in('post_id', postIds),
      ]);
      // A post can appear under more than one URL (http/https, www) — sum them.
      for (const r of pages ?? []) {
        const k = String((r as any).post_id);
        const cur = pageTotals.get(k) ?? { impressions: 0, clicks: 0 };
        pageTotals.set(k, { impressions: cur.impressions + (r as any).impressions, clicks: cur.clicks + (r as any).clicks });
      }
      for (const r of pq ?? []) {
        const k = String((r as any).post_id);
        queriesOf.set(k, [...(queriesOf.get(k) ?? []), {
          query: (r as any).query, impressions: (r as any).impressions,
          clicks: (r as any).clicks, position: (r as any).position,
        }]);
      }
    }

    const inputs: BetInput[] = [];
    for (const p of posts as any[]) {
      const slot = slotOf.get(`${p.strategy_id}:${p.slot_id}`);
      const target = slot?.target_keyword?.trim();
      if (!target || !p.published_at) continue;   // an ad-hoc post made no bet
      const totals = pageTotals.get(String(p.id)) ?? { impressions: 0, clicks: 0 };
      inputs.push({
        postId: String(p.id),
        title: p.title ?? '',
        publishedAt: p.published_at,
        targetKeyword: target,
        secondaryKeywords: slot?.secondary_keywords ?? [],
        pageImpressions: totals.impressions,
        pageClicks: totals.clicks,
        queries: queriesOf.get(String(p.id)) ?? [],
      });
    }
    return { bets: gradeBets(inputs, now, brands), asOf };
  } catch {
    return { bets: [], asOf: null };
  }
}
