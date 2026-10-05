/**
 * Diagnosis — the step between measuring and planning.
 *
 * The planner used to go straight from a month's numbers to a new plan, and
 * each plan's `notes` named a different cause for last month ("70% posts about
 * Grove", "generic corporate tone", "too few clusters") that nothing ever
 * checked. So the loop never learned which cause was real: it changed
 * something every month and kept whatever it had not happened to change.
 *
 * This names the single biggest reason, FROM NUMBERS, before the planner runs,
 * and tells it that this plan has to answer that reason. It is rules, not a
 * model call, on purpose:
 *   - it cannot invent a cause the data doesn't show — the thing it replaces
 *     is exactly a model inventing causes;
 *   - it costs no wall clock, and the strategy call is already short of it
 *     (October's plan fell back from the strategy model for lack of time);
 *   - it is testable, which an LLM's judgement of "the biggest reason" is not.
 *
 * And it closes the loop: the diagnosis is stored on the strategy row
 * (strategies.diagnosis, 0044) with the metric it was judged on, and the next
 * build reads it back and says whether that metric moved. "Last month's answer
 * did not work" is the sentence the loop could never produce before.
 */
import { supabaseAdmin } from '../supabase/admin';
import type { Bet } from './bets';
import type { MonthlyReport } from './review';
import { isBrandQuery } from './seeds';

export type PipelineHealth = {
  publishedLast30: number;
  /** null when nothing has ever been published. */
  daysSinceLastPublish: number | null;
  inReview: number;
  oldestReviewDays: number | null;
};

export type SearchHealth = {
  /** Summed over the query rows, so brand share has one denominator. */
  queryImpressions: number;
  brandImpressions: number;
  nonBrandQueries: number;
  bestNonBrandPosition: number | null;
};

export type PoolHealth = { winnableClusters: number; slots: number; widened: boolean };

export type DiagnosisSignals = {
  pipeline: PipelineHealth | null;
  search: SearchHealth | null;       // null without Search Console
  bets: Bet[];
  pool: PoolHealth | null;            // null when demand was not measured
};

export type DiagnosisKind =
  | 'not_shipping'
  | 'brand_only'
  | 'not_shown'
  | 'out_of_reach'
  | 'thin_demand'
  | 'working'
  | 'too_early';

export type MetricName =
  | 'published_last_30' | 'brand_share_pct' | 'unseen_share_pct'
  | 'top20_bets' | 'winnable_clusters';

/** Which way is better, so a follow-up can say "improved" without a table. */
const BETTER: Record<MetricName, 'up' | 'down'> = {
  published_last_30: 'up',
  brand_share_pct: 'down',
  unseen_share_pct: 'down',
  top20_bets: 'up',
  winnable_clusters: 'up',
};

export type Finding = {
  kind: DiagnosisKind;
  headline: string;
  evidence: string;
  /** What THIS plan has to do about it. */
  answer: string;
  metric: { name: MetricName; value: number } | null;
};

export type Diagnosis = { primary: Finding; others: Finding[] };

/** What is stored on the strategy row and read back next month. */
export type StoredDiagnosis = {
  kind: DiagnosisKind;
  headline: string;
  metric: { name: MetricName; value: number } | null;
};

// Thresholds. Each is the smallest amount of evidence that makes the finding
// more than noise on a young site; below it the finding simply doesn't fire.
const STALL_DAYS = 14;
const MIN_QUERY_IMPRESSIONS = 30;
const BRAND_SHARE = 0.8;
const MIN_JUDGED = 5;
const UNSEEN_SHARE = 0.5;

/** Every metric a finding can be judged on, computed once. */
export function metrics(s: DiagnosisSignals): Partial<Record<MetricName, number>> {
  const out: Partial<Record<MetricName, number>> = {};
  if (s.pipeline) out.published_last_30 = s.pipeline.publishedLast30;
  if (s.search && s.search.queryImpressions > 0) {
    out.brand_share_pct = Math.round((s.search.brandImpressions / s.search.queryImpressions) * 100);
  }
  const judged = s.bets.filter((b) => b.verdict !== 'too_early' && b.verdict !== 'brand');
  if (judged.length) {
    out.unseen_share_pct = Math.round((judged.filter((b) => b.verdict === 'unseen').length / judged.length) * 100);
    out.top20_bets = judged.filter((b) => b.verdict === 'won' || b.verdict === 'close').length;
  }
  if (s.pool) out.winnable_clusters = s.pool.winnableClusters;
  return out;
}

/**
 * Every finding that fires, most fundamental first. The order is the point:
 * a stalled pipeline makes every downstream number meaningless, a site Google
 * shows only for its name has no topic signal to read, and so on down. The
 * first one is the diagnosis; the rest are still true and still shown.
 */
export function diagnose(s: DiagnosisSignals): Diagnosis {
  const m = metrics(s);
  const out: Finding[] = [];
  const p = s.pipeline;

  if (p) {
    const stalled = p.daysSinceLastPublish == null
      ? p.inReview > 0
      : p.daysSinceLastPublish >= STALL_DAYS;
    const backlog = p.inReview >= 5 && (p.oldestReviewDays ?? 0) >= STALL_DAYS;
    if (stalled || backlog) {
      out.push({
        kind: 'not_shipping',
        headline: 'Articles are not reaching readers',
        evidence: [
          p.daysSinceLastPublish == null ? 'nothing has been published yet' : `last article published ${p.daysSinceLastPublish} days ago`,
          `${p.publishedLast30} published in the last 30 days`,
          p.inReview ? `${p.inReview} drafts waiting in review, the oldest ${p.oldestReviewDays} days` : '',
        ].filter(Boolean).join('; '),
        answer: 'No choice of topics fixes a plan that does not ship. Lead "direction.month" and "notes" with this: '
          + (p.inReview
            ? `${p.inReview} finished drafts are waiting for the owner, and reviewing them is the single thing that moves this month.`
            : 'nothing has gone out, so this month is about getting the first articles live.')
          + ' Do not add pillars or widen scope this month.',
        metric: { name: 'published_last_30', value: m.published_last_30 ?? 0 },
      });
    }
  }

  if (s.search && s.search.queryImpressions >= MIN_QUERY_IMPRESSIONS
      && (m.brand_share_pct ?? 0) >= BRAND_SHARE * 100) {
    out.push({
      kind: 'brand_only',
      headline: 'Google shows this site almost only to people searching its name',
      evidence: `${m.brand_share_pct}% of search impressions are for the business's own name; ${s.search.nonBrandQueries} other queries`
        + (s.search.bestNonBrandPosition != null ? `, the best at position ${s.search.bestNonBrandPosition}` : ''),
      answer: 'Every slot targets a problem a stranger searches for. No slot names the business, and none targets a query listed under BRAND SEARCHES.',
      metric: { name: 'brand_share_pct', value: m.brand_share_pct! },
    });
  }

  const judged = s.bets.filter((b) => b.verdict !== 'too_early' && b.verdict !== 'brand');
  if (judged.length >= MIN_JUDGED && (m.unseen_share_pct ?? 0) >= UNSEEN_SHARE * 100) {
    out.push({
      kind: 'not_shown',
      headline: 'Google is not showing most of these articles for anything',
      evidence: `${m.unseen_share_pct}% of the ${judged.length} judged articles had no impressions at all`,
      answer: 'This is reach, not topic choice: a page Google never shows cannot rank for any keyword. Pick only the longest, most specific targets in MEASURED DEMAND (four or more words, the lowest KD on offer), and have each new slot link to and from the pages Google already shows.',
      metric: { name: 'unseen_share_pct', value: m.unseen_share_pct! },
    });
  }

  if (judged.length >= MIN_JUDGED && (m.top20_bets ?? 0) === 0) {
    out.push({
      kind: 'out_of_reach',
      headline: 'Every target so far has been out of this domain\'s reach',
      evidence: `0 of ${judged.length} judged targets reached the top 20`,
      answer: 'Choose targets narrower and easier than anything in WHAT WE ALREADY TRIED — more words, lower KD — even at a fraction of the volume.',
      metric: { name: 'top20_bets', value: 0 },
    });
  }

  if (s.pool && s.pool.winnableClusters < s.pool.slots) {
    out.push({
      kind: 'thin_demand',
      headline: 'Too few winnable keywords for this month\'s slots',
      evidence: `${s.pool.winnableClusters} relevant keyword clusters for ${s.pool.slots} slots${s.pool.widened ? ', after a second research round' : ''}`,
      answer: 'Plan fewer slots rather than inventing keywords, and say in "notes" that research, not writing, is the constraint.',
      metric: { name: 'winnable_clusters', value: s.pool.winnableClusters },
    });
  }

  if ((m.top20_bets ?? 0) > 0) {
    out.push({
      kind: 'working',
      headline: 'Some targets are working',
      evidence: `${m.top20_bets} of ${judged.length} judged targets reached the top 20`,
      answer: 'Double down: choose more targets of the same shape and size as the ones in TOP 10 / 11-20.',
      metric: { name: 'top20_bets', value: m.top20_bets! },
    });
  }

  if (!out.length) {
    out.push({
      kind: 'too_early',
      headline: 'Not enough evidence yet to name a cause',
      evidence: `${judged.length} articles old enough to judge`,
      answer: 'Plan from MEASURED DEMAND and keep every target specific; next month will have evidence.',
      metric: null,
    });
  }

  return { primary: out[0], others: out.slice(1) };
}

export function storedDiagnosis(d: Diagnosis): StoredDiagnosis {
  return { kind: d.primary.kind, headline: d.primary.headline, metric: d.primary.metric };
}

export type FollowUp = {
  previous: StoredDiagnosis;
  before: number;
  after: number | null;
  verdict: 'resolved' | 'improved' | 'unchanged' | 'worse' | 'unmeasured';
};

/** Did last month's diagnosis move? Judged on the metric it was stored with. */
export function followUp(previous: StoredDiagnosis | null | undefined, now: Diagnosis, s: DiagnosisSignals): FollowUp | null {
  if (!previous?.metric) return null;
  const after = metrics(s)[previous.metric.name];
  const before = previous.metric.value;
  const stillFires = [now.primary, ...now.others].some((f) => f.kind === previous.kind);
  let verdict: FollowUp['verdict'];
  if (after == null) verdict = 'unmeasured';
  else if (!stillFires) verdict = 'resolved';
  else if (after === before) verdict = 'unchanged';
  else verdict = (after > before) === (BETTER[previous.metric.name] === 'up') ? 'improved' : 'worse';
  return { previous, before, after: after ?? null, verdict };
}

const METRIC_LABEL: Record<MetricName, string> = {
  published_last_30: 'articles published in 30 days',
  brand_share_pct: '% of impressions on the brand name',
  unseen_share_pct: '% of judged articles never shown',
  top20_bets: 'targets in the top 20',
  winnable_clusters: 'winnable keyword clusters',
};

export function formatDiagnosisForPrompt(d: Diagnosis, fu: FollowUp | null): string {
  const lines = [
    'DIAGNOSIS — the single biggest reason this blog is not growing, computed from the numbers (not a guess):',
    `PRIMARY: ${d.primary.headline} — ${d.primary.evidence}.`,
    `THIS PLAN MUST ANSWER IT: ${d.primary.answer}`,
  ];
  if (d.others.length) {
    lines.push('ALSO TRUE (respect these too):');
    for (const f of d.others) lines.push(`  - ${f.headline} — ${f.evidence}. ${f.answer}`);
  }
  if (fu) {
    const label = fu.previous.metric ? METRIC_LABEL[fu.previous.metric.name] : '';
    const moved = fu.after == null ? 'not measurable this month' : `${fu.before} → ${fu.after}`;
    const tail = {
      resolved: 'It no longer applies — do not keep planning around it.',
      improved: 'It is moving the right way — keep the approach that moved it.',
      unchanged: 'Last month\'s plan did not move it. Do not repeat that approach; change it.',
      worse: 'It got worse under last month\'s plan. Do not repeat that approach; change it.',
      unmeasured: '',
    }[fu.verdict];
    lines.push(`LAST MONTH'S DIAGNOSIS: "${fu.previous.headline}" (${label}: ${moved}). ${tail}`.trim());
  }
  lines.push('In "notes", begin with the diagnosis in a few words and say how this plan answers it.');
  return lines.join('\n');
}

/** Search health from the report's query rows, split by brand. */
export function searchHealth(
  sc: MonthlyReport['search_console'] | null | undefined,
  brands: string[],
): SearchHealth | null {
  if (!sc || !sc.topQueries?.length) return null;
  let total = 0;
  let brand = 0;
  let nonBrand = 0;
  let best: number | null = null;
  for (const q of sc.topQueries) {
    total += q.impressions;
    if (isBrandQuery(q.query, brands)) { brand += q.impressions; continue; }
    if (q.impressions > 0) nonBrand++;
    if (best == null || q.position < best) best = q.position;
  }
  return { queryImpressions: total, brandImpressions: brand, nonBrandQueries: nonBrand, bestNonBrandPosition: best };
}

/** Publishing health. Fail-soft: null reads as "unknown", never as "stalled". */
export async function loadPipelineHealth(domainId: string, now = new Date()): Promise<PipelineHealth | null> {
  try {
    const sb = supabaseAdmin();
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const [recent, last, review, oldest] = await Promise.all([
      sb.from('posts').select('id', { count: 'exact', head: true })
        .eq('domain_id', domainId).eq('status', 'published').gte('published_at', since),
      sb.from('posts').select('published_at')
        .eq('domain_id', domainId).eq('status', 'published').not('published_at', 'is', null)
        .order('published_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('posts').select('id', { count: 'exact', head: true })
        .eq('domain_id', domainId).eq('status', 'review'),
      sb.from('posts').select('created_at')
        .eq('domain_id', domainId).eq('status', 'review')
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ]);
    if (recent.error || last.error || review.error || oldest.error) return null;
    const days = (iso: string | null | undefined) =>
      iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : null;
    return {
      publishedLast30: recent.count ?? 0,
      daysSinceLastPublish: days((last.data as any)?.published_at),
      inReview: review.count ?? 0,
      oldestReviewDays: days((oldest.data as any)?.created_at),
    };
  } catch {
    return null;
  }
}
