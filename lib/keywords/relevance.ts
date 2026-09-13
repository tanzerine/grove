/**
 * Step 4½: is this phrase about the customer's problem at all?
 *
 * ── The plan that made this necessary ──────────────────────────────────────
 * trygroveai.com, 2026-09-13 11:46Z, the first build with the customer
 * profile working and DataForSEO live. Seeds were right ("publish blog
 * posts", "content marketing", "embed blog no cms"). Five of nine slots came
 * back targeting "dog with the blog cast" (33,100/mo, KD 6 — a Disney
 * series), "blog the dog" (60,500/mo), "harriet the spy: blog wars movie",
 * "the food lab blog" and "unscramble words 1-11 to complete the blog". The
 * strategist, told not to invent keywords while clusters were listed, wrote
 * article topics around every one of them.
 *
 * Nothing in the pipeline had asked the only question that mattered. Labs
 * expansion returns any high-volume phrase that shares a word with the seed;
 * `selectKeywords` ranks on volume × win probability; `buildClusters` groups
 * by token overlap. All three are arithmetic, and arithmetic cannot tell a
 * founder's problem from a sitcom — "blog" is a token in both.
 *
 * ── What this does ─────────────────────────────────────────────────────────
 * One workhorse-model call per plan, over the CLUSTERS (a few dozen, not the
 * several hundred raw candidates): for each pillar phrase, would a person in
 * this customer profile search it while dealing with the problem the
 * business solves? Verdicts are per cluster, so a partial answer degrades to
 * "keep the ones it didn't rule on" rather than to dropping the plan's
 * demand on the floor. The dropped phrases go to the ledger as `rejected`
 * with reason `off_topic`, which is what lets the owner see WHY "blog the
 * dog" was passed over — and keeps it from being proposed again next month.
 *
 * Fail-soft, and loud: a failed call keeps every cluster (the pre-existing
 * behaviour) and warns, because the planner's own rule against off-topic
 * clusters is the second layer, not this one.
 */
import { llmCall, extractJson } from '../llm';
import type { KeywordCluster } from './cluster';
import type { CustomerProfile } from '../strategy/icp';

export type RelevanceContext = {
  business: { name: string; description?: string; products_services?: string[] };
  icp?: CustomerProfile | null;
};

export type Screened = {
  kept: KeywordCluster[];
  dropped: { cluster: KeywordCluster; why: string }[];
  /** True when the model could not be consulted and everything was kept. */
  failed: boolean;
};

/** One line per cluster for the prompt: the pillar, then up to four members. */
export function describeClusters(clusters: KeywordCluster[]): string {
  return clusters
    .map((c, i) => {
      const also = c.members.slice(0, 4).map((m) => m.keyword).join(', ');
      return `C${i + 1}. "${c.pillar.keyword}"${also ? ` — also: ${also}` : ''}`;
    })
    .join('\n');
}

/**
 * Parse the model's verdicts into the set of 1-based cluster numbers to DROP.
 *
 * Pure. Tolerant of the ways a model mangles a list — string numbers, a bare
 * array, a `c` outside the range, a duplicate — and strict about the one
 * thing that matters: a cluster is dropped only on an explicit
 * `relevant: false`. Anything ambiguous keeps the cluster.
 */
export function parseVerdicts(raw: unknown, n: number): Map<number, string> {
  const drop = new Map<number, string>();
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).verdicts)
      ? (raw as any).verdicts
      : [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const c = Number((v as any).c ?? (v as any).cluster ?? (v as any).id);
    if (!Number.isInteger(c) || c < 1 || c > n) continue;
    if ((v as any).relevant === false) {
      const why = typeof (v as any).why === 'string' ? (v as any).why.trim() : '';
      drop.set(c, why || 'off topic');
    }
  }
  return drop;
}

/** Split clusters by a drop set. Pure; exported for the tests. */
export function applyVerdicts(clusters: KeywordCluster[], drop: Map<number, string>): Omit<Screened, 'failed'> {
  const kept: KeywordCluster[] = [];
  const dropped: Screened['dropped'] = [];
  clusters.forEach((c, i) => {
    const why = drop.get(i + 1);
    if (why != null) dropped.push({ cluster: c, why });
    else kept.push(c);
  });
  return { kept, dropped };
}

export async function screenClusters(
  clusters: KeywordCluster[],
  ctx: RelevanceContext,
  opts: { timeoutMs?: number } = {},
): Promise<Screened> {
  if (!clusters.length) return { kept: [], dropped: [], failed: false };

  const icp = ctx.icp;
  const who = icp && icp.segments.length
    ? icp.segments.map((s) => `- ${s.name}${s.situation ? ` — ${s.situation}` : ''}`).join('\n')
    : '(no customer profile — judge from the business alone)';
  const pains = icp?.pains?.length ? `\nWhat hurts them: ${icp.pains.slice(0, 5).join(' · ')}` : '';

  const system = `You screen keyword clusters for a business blog. For each cluster you decide
ONE thing: would a person in this customer profile search the pillar phrase
while dealing with the problem this business solves, such that an article on
it could plausibly lead them toward the business?

Mark relevant: false when the phrase is
- a different meaning of the same words (a TV show, film, book, recipe blog,
  game, place, person, product with an unrelated purpose),
- a job-seeker, student or trivia query (salary, internship, course, quiz,
  "unscramble", "cast", "characters", "season"),
- a competitor or third-party brand name on its own,
- a topic with no path from the reader's problem to this business.

Volume is NOT a reason to keep a cluster. A phrase searched by a million
people who will never need this business is worth nothing to it. When unsure,
keep it — the planner decides what to write; you only remove what is clearly
about something else.`;

  const user = `BUSINESS
${ctx.business.name}: ${ctx.business.description ?? ''}
Sells: ${(ctx.business.products_services ?? []).join(', ') || 'unknown'}

CUSTOMER
${who}${pains}

CLUSTERS
${describeClusters(clusters)}

Return JSON only, one verdict per cluster:
{ "verdicts": [ { "c": 1, "relevant": true }, { "c": 2, "relevant": false, "why": "a Disney series, not a business problem" } ] }`;

  try {
    const { text } = await llmCall({ system, user, maxTokens: 1200, timeoutMs: opts.timeoutMs ?? 45_000 });
    const drop = parseVerdicts(extractJson<unknown>(text), clusters.length);
    const out = applyVerdicts(clusters, drop);
    if (out.dropped.length) {
      console.warn(`[relevance] dropped ${out.dropped.length} of ${clusters.length} clusters as off-topic for ${ctx.business.name}: ` +
        out.dropped.map((d) => `"${d.cluster.pillar.keyword}" (${d.why})`).join('; '));
    }
    return { ...out, failed: false };
  } catch (err) {
    console.warn(`[relevance] screen failed for ${ctx.business.name}, keeping every cluster: ${String((err as any)?.message ?? err)}`);
    return { kept: clusters, dropped: [], failed: true };
  }
}
