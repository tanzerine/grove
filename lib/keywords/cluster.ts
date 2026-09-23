/**
 * Step 5: group keywords into clusters, one article per cluster.
 *
 * ── Why cluster at all ─────────────────────────────────────────────────────
 * A page does not rank for one keyword. It ranks for the phrase it targets
 * plus every near-variant that shares the intent — so the demand a single
 * article can capture is the SUM across its cluster, not the head term's
 * volume. Planning against the head term alone systematically undervalues
 * every topic and picks the wrong ones: a 200/mo head with eight 150/mo
 * variants beats an 800/mo head that stands alone, and volume-sorting cannot
 * see that.
 *
 * This is also the opposite trade from `lib/pseo.ts`, deliberately. pSEO makes
 * N thin pages, one keyword each; this makes one substantial page per cluster.
 * Both are legitimate and they are not interchangeable — pSEO buys coverage,
 * clustering buys depth and carries far less thin-content risk.
 *
 * ── What a cluster is worth ────────────────────────────────────────────────
 *   value  = Σ volume over every member          (all the traffic in reach)
 *   gate   = the PILLAR's difficulty             (what you must actually beat)
 *   score  = value × winProbability(gate)
 *
 * The gate is the pillar's difficulty and not the cluster's average, because
 * ranking is won or lost on the page's primary target. Averaging in a pile of
 * easy long-tail variants would make a brutal head term look reachable, which
 * is exactly the error that produces a year of articles stuck on page three.
 *
 * ── Close variants are ONE keyword, counted once ───────────────────────────
 * Google Ads reports volume per "close variant" bucket, not per string, and
 * Labs returns every string it knows in the bucket: "content marketing",
 * "content marketing content", "content for content marketing" all carry the
 * bucket's 110,000/mo. Summed as members, eight spellings of one 60,500/mo
 * query became a 484,000/mo cluster — the sum above is only the real prize
 * when its terms are different searches. `collapseCloseVariants` folds a
 * bucket back to one phrase before anything is added up.
 */
import { STOP } from '../related-posts';
import {
  opportunityScore, winProbability, effectiveVolume, DEFAULT_KD_CEILING, type ScoredKeyword,
} from './opportunity';


export type KeywordCluster = {
  /** The phrase the article actually targets — highest opportunity in the set. */
  pillar: ScoredKeyword;
  /** Secondary phrases the same page should also satisfy. Excludes the pillar. */
  members: ScoredKeyword[];
  /** Σ volume across pillar + members. The "implicit search sum" — the real
   *  size of the prize, and the number worth sorting a plan by. */
  totalVolume: number;
  /** The pillar's difficulty: what must be beaten for any of it to land. */
  difficulty: number | null;
  /** totalVolume × winProbability(difficulty). Estimated monthly impressions. */
  score: number;
};

/**
 * Tokens for overlap comparison, CJK-aware.
 *
 * Latin scripts split on non-word characters and drop stopwords. CJK cannot:
 * Chinese has no word spaces at all, and Korean eojeol glue particles onto
 * stems, so "블로그 자동화" and "블로그 자동화를" would share nothing on a
 * whitespace split. Both get CHARACTER BIGRAMS instead, which is the standard
 * cheap segmentation for these scripts and makes those two phrases overlap
 * heavily, as they should.
 */
export function clusterTokens(phrase: string): Set<string> {
  const out = new Set<string>();
  const runs = (phrase ?? '').toLowerCase().split(/[^a-z0-9가-힣ぁ-ゟァ-ヿ一-鿿]+/);
  for (const run of runs) {
    if (!run) continue;
    if (/[가-힣ぁ-ゟァ-ヿ一-鿿]/.test(run)) {
      if (run.length <= 2) out.add(run);
      else for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
    } else if (run.length >= 2 && !STOP.has(run) && !/^\d+$/.test(run)) {
      out.add(run);
    }
  }
  return out;
}

/** Jaccard-ish: shared tokens over the smaller set, so a short phrase can
 *  still belong to a longer one ("blog automation" inside "best blog
 *  automation tool for small teams" scores 1, which is the intent). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * The close-variant bucket a phrase belongs to, or null when there is no
 * evidence of one. Same content tokens (stopwords out, order ignored) AND the
 * same volume is the signature of Ads reporting one bucket under several
 * strings; two phrases with the same words and different volumes ("content
 * marketing" 110k vs "marketing content" 246k) are different buckets and
 * stay apart. Unmeasured phrases never collapse — without a volume there is
 * no bucket to have matched.
 */
export function variantKey(k: ScoredKeyword): string | null {
  if (k.volume == null) return null;
  const toks = [...clusterTokens(k.keyword)].sort();
  if (!toks.length) return null;
  return `${toks.join(' ')}|${k.volume}`;
}

/** The spelling worth keeping for a bucket: measured over unmeasured
 *  difficulty, then the fewest words ("content marketing" over "content of
 *  marketing"), then the shortest string, then alphabetical so the choice is
 *  stable across runs. */
function preferVariant(a: ScoredKeyword, b: ScoredKeyword): boolean {
  if ((a.difficulty != null) !== (b.difficulty != null)) return a.difficulty != null;
  const wa = a.keyword.trim().split(/\s+/).length;
  const wb = b.keyword.trim().split(/\s+/).length;
  if (wa !== wb) return wa < wb;
  if (a.keyword.length !== b.keyword.length) return a.keyword.length < b.keyword.length;
  return a.keyword < b.keyword;
}

/**
 * One phrase per close-variant bucket, in first-seen order. Pure. Phrases
 * whose bucket is in `claimed` are dropped outright — that is how the long
 * tail is kept from re-adding a bucket a lead phrase already represents.
 */
export function collapseCloseVariants(
  keywords: ScoredKeyword[],
  claimed: ReadonlySet<string> = new Set(),
): ScoredKeyword[] {
  const slot = new Map<string, number>();
  const out: ScoredKeyword[] = [];
  for (const k of keywords) {
    const key = variantKey(k);
    if (key == null) { out.push(k); continue; }
    if (claimed.has(key)) continue;
    const at = slot.get(key);
    if (at == null) { slot.set(key, out.length); out.push(k); continue; }
    if (preferVariant(k, out[at])) out[at] = k;
  }
  return out;
}

export type ClusterOptions = {
  /** Minimum overlap to join a cluster. 0.5 = half the shorter phrase's tokens
   *  are shared. Lower and unrelated topics merge; higher and obvious variants
   *  split into separate articles that then compete with each other. */
  threshold?: number;
  maxClusters?: number;
  /** Secondary keywords per cluster, excluding the pillar. Past roughly eight
   *  an article stops being about one thing, which costs the ranking the
   *  cluster was built to win. */
  maxMembers?: number;
  ceiling?: number;
  /**
   * Drop clusters whose summed volume is under this. This is where the volume
   * floor belongs — on the article's whole prize, not on each phrase before
   * the phrases have been added up (see Selection.longTail).
   */
  minTotalVolume?: number;
  /**
   * Phrases that may join a cluster but never lead one — the long tail.
   * A lone 40/mo variant is not an article; the same variant under a 900/mo
   * pillar is thirty more readers a month for the same page.
   */
  membersOnly?: ScoredKeyword[];
};

/**
 * Greedy agglomeration, highest-opportunity phrase first.
 *
 * Greedy rather than k-means or hierarchical for three reasons that matter
 * more than cluster quality: it is deterministic (the same month's inputs
 * produce the same plan, so a diff is meaningful), the pillar is chosen rather
 * than emergent (a centroid is not a phrase anyone can write an article
 * about), and it is inspectable — an owner asking "why is this keyword in this
 * article" gets a real answer.
 */
export function buildClusters(keywords: ScoredKeyword[], opts: ClusterOptions = {}): KeywordCluster[] {
  const threshold = opts.threshold ?? 0.5;
  const maxMembers = opts.maxMembers ?? 8;
  const ceiling = opts.ceiling ?? DEFAULT_KD_CEILING;

  // Sort by opportunity so the pillar of each cluster is its best keyword.
  // Unscorable candidates (score 0) sort last and become their own single-
  // keyword clusters rather than silently attaching to something measured.
  // Members-only phrases sort after every pillar candidate whatever their
  // score, so they can only ever be picked up as members; the ones nothing
  // claims are dropped at the end rather than becoming one-phrase clusters.
  // Fold close-variant buckets first, leads and tail alike, so one bucket is
  // one phrase with one volume wherever it landed. A tail phrase whose bucket
  // a lead already represents is dropped, not demoted — it is the same search.
  const leads = collapseCloseVariants(keywords);
  const leadKeys = new Set(leads.map(variantKey).filter((k): k is string => k != null));
  const tail = collapseCloseVariants(opts.membersOnly ?? [], leadKeys);
  const leadCount = leads.length;
  const pool = [
    ...leads.sort((a, b) => opportunityScore(b, ceiling) - opportunityScore(a, ceiling)),
    ...tail,
  ];
  const canLead = (i: number) => i < leadCount;
  const tokenCache = new Map<string, Set<string>>();
  const tok = (k: string) => {
    let t = tokenCache.get(k);
    if (!t) { t = clusterTokens(k); tokenCache.set(k, t); }
    return t;
  };

  const taken = new Set<number>();
  const clusters: KeywordCluster[] = [];

  for (let i = 0; i < pool.length; i++) {
    if (taken.has(i)) continue;
    if (!canLead(i)) break;   // only unclaimed tail is left — nothing may lead it
    taken.add(i);
    const pillar = pool[i];
    const pTok = tok(pillar.keyword);
    const members: ScoredKeyword[] = [];

    for (let j = i + 1; j < pool.length && members.length < maxMembers; j++) {
      if (taken.has(j)) continue;
      if (overlap(pTok, tok(pool[j].keyword)) >= threshold) {
        taken.add(j);
        members.push(pool[j]);
      }
    }

    // Effective volume: what was bought or what was observed, whichever is
    // larger — a revealed phrase with no Ads figure still counts its
    // impressions toward the prize (see opportunity.ts RevealedDemand).
    const totalVolume = [pillar, ...members].reduce((s, k) => s + (effectiveVolume(k) ?? 0), 0);
    clusters.push({
      pillar,
      members,
      totalVolume,
      difficulty: pillar.difficulty,
      score: Math.round(totalVolume * winProbability(pillar.difficulty, ceiling)),
    });
  }

  const floor = opts.minTotalVolume ?? 0;
  return clusters
    .filter((c) => c.totalVolume >= floor)
    .sort((a, b) => {
      const d = b.score - a.score;
      if (d !== 0) return d;
      // Equal expected impressions: prefer the DEEPER cluster. Same traffic
      // reachable several ways is a sturdier bet than the same traffic riding
      // on one phrase — more internal-link surface, broader semantic coverage,
      // and a near-miss on the pillar still earns something from the variants.
      return b.members.length - a.members.length;
    })
    .slice(0, opts.maxClusters ?? clusters.length);
}

/**
 * Render clusters for the planner's prompt.
 *
 * This exists because `formatDemandForPrompt` did the opposite: it computed a
 * demand score and then emitted a bare comma-separated list, so the model
 * chose keywords on semantic plausibility with no idea which had ten times the
 * demand of another. Numbers that were computed and then withheld are worse
 * than numbers never computed — they create the appearance of a data-driven
 * plan over a guess.
 *
 * The cluster total is stated separately from the pillar's own volume because
 * it is the number the article is actually worth, and a planner shown only the
 * pillar volume will systematically under-rate deep clusters.
 */
export function formatClustersForPrompt(clusters: KeywordCluster[]): string {
  if (!clusters.length) return '(no measured demand — plan from the customer profile)';
  const n = (v: number | null) => (v == null ? '?' : v.toLocaleString('en-US'));
  // What Google already showed the domain for this phrase. Stated beside the
  // purchased figure rather than folded into it, because the two disagree
  // by 30x on real data and the planner should see which one it is trusting.
  const seen = (k: ScoredKeyword) => {
    const r = k.revealed;
    if (!r) return '';
    return ` — Google already shows this site for it: ${n(r.impressions)} impressions in ${r.days}d at position ${r.position}`;
  };
  return clusters
    .map((c, i) => {
      // "difficulty", not "KD": the number is grove's (links AND the domains
      // holding the SERP), and calling it KD invites the model to read it on
      // a provider's scale it no longer follows.
      const head = `C${i + 1}. "${c.pillar.keyword}" — difficulty ${c.difficulty ?? '?'}/100, ${n(c.pillar.volume)}/mo` +
        (c.members.length ? `, cluster total ${n(c.totalVolume)}/mo` : '') +
        (c.pillar.intent ? `, ${c.pillar.intent}` : '') + seen(c.pillar);
      if (!c.members.length) return head;
      const also = c.members.map((m) => `${m.keyword} (${n(m.volume)})`).join(', ');
      return `${head}\n    also covers: ${also}`;
    })
    .join('\n');
}
