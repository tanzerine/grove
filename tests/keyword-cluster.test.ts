import { describe, it, expect } from 'vitest';
import {
  buildClusters, clusterTokens, overlap, formatClustersForPrompt, collapseCloseVariants, variantKey,
} from '../lib/keywords/cluster';
import type { ScoredKeyword } from '../lib/keywords/opportunity';

const kw = (
  keyword: string, volume: number | null, difficulty: number | null,
): ScoredKeyword => ({ keyword, volume, difficulty, intent: 'informational', source: 'dataforseo' });

describe('clusterTokens', () => {
  it('drops stopwords and short noise from latin phrases', () => {
    const t = clusterTokens('the best blog automation tool');
    expect(t.has('blog')).toBe(true);
    expect(t.has('automation')).toBe(true);
    expect(t.has('the')).toBe(false);   // STOP
    expect(t.has('best')).toBe(false);  // STOP
  });

  it('uses character bigrams for CJK, so particles do not break the match', () => {
    // A whitespace split would make these share nothing: Korean glues particles
    // onto stems. Bigrams make them overlap, which is the correct reading.
    const a = clusterTokens('블로그 자동화');
    const b = clusterTokens('블로그 자동화를');
    expect(overlap(a, b)).toBeGreaterThan(0.8);
  });

  it('segments Chinese, which has no word spaces at all', () => {
    const a = clusterTokens('博客自动化');
    const b = clusterTokens('博客自动化工具');
    expect(a.size).toBeGreaterThan(0);
    expect(overlap(a, b)).toBeGreaterThan(0.8);
  });

  it('keeps unrelated phrases apart', () => {
    expect(overlap(clusterTokens('blog automation'), clusterTokens('plumbing repair'))).toBe(0);
    expect(overlap(clusterTokens('블로그 자동화'), clusterTokens('배관 수리'))).toBe(0);
  });
});

describe('buildClusters', () => {
  it('gathers variants under the highest-opportunity pillar', () => {
    const [c] = buildClusters([
      kw('blog automation tool', 200, 10),
      kw('blog automation software', 150, 12),
      kw('best blog automation', 120, 9),
    ], { ceiling: 30 });

    expect(c.pillar.keyword).toBe('blog automation tool');  // biggest winnable
    expect(c.members).toHaveLength(2);
  });

  it('totalVolume is the implicit search SUM — the reason clustering exists', () => {
    const [c] = buildClusters([
      kw('blog automation tool', 200, 10),
      kw('blog automation software', 150, 10),
      kw('blog automation guide', 100, 10),
    ], { ceiling: 30 });

    expect(c.totalVolume).toBe(450);        // not 200
    expect(c.score).toBe(450);              // winProbability 1 at kd 10
  });

  it('a deep cluster beats a bigger lone keyword — what volume-sorting misses', () => {
    // The lone head term is 3x the cluster's pillar on its own, and loses:
    // 600 standalone vs 200+200+200+200 = 800 reachable from one article.
    const clusters = buildClusters([
      kw('content marketing', 600, 12),
      kw('blog automation tool', 200, 12),
      kw('blog automation software', 200, 12),
      kw('blog automation workflow', 200, 12),
      kw('blog automation pricing', 200, 12),
    ], { ceiling: 30 });

    expect(clusters[0].pillar.keyword).toBe('blog automation tool');
    expect(clusters[0].totalVolume).toBe(800);
    expect(clusters[0].score).toBeGreaterThan(clusters[1].score);
  });

  it('on equal expected traffic, depth wins', () => {
    // 800 reachable four ways is sturdier than 800 riding on one phrase.
    const clusters = buildClusters([
      kw('content marketing', 800, 12),
      kw('blog automation tool', 200, 12),
      kw('blog automation software', 200, 12),
      kw('blog automation workflow', 200, 12),
      kw('blog automation pricing', 200, 12),
    ], { ceiling: 30 });

    expect(clusters[0].score).toBe(clusters[1].score);      // a genuine tie
    expect(clusters[0].pillar.keyword).toBe('blog automation tool');
    expect(clusters[0].members).toHaveLength(3);
  });

  it('gates on the PILLAR difficulty, not the average', () => {
    // A brutal head term surrounded by easy variants must NOT look reachable.
    // Averaging would rate this cluster as a near-certain win; it is not.
    const [c] = buildClusters([
      kw('seo', 100_000, 95),
      kw('seo tips', 500, 5),
      kw('seo basics', 400, 5),
    ], { ceiling: 30 });

    expect(c.pillar.keyword).toBe('seo');
    expect(c.difficulty).toBe(95);
    // 100_900 total volume, but gated at p = 0.02
    expect(c.score).toBeLessThan(c.totalVolume * 0.05);
  });

  it('caps members so an article stays about one thing', () => {
    const many = Array.from({ length: 20 }, (_, i) => kw(`blog automation variant ${i}`, 100, 10));
    const [c] = buildClusters(many, { maxMembers: 8 });
    expect(c.members.length).toBeLessThanOrEqual(8);
  });

  it('never assigns a keyword to two clusters', () => {
    const clusters = buildClusters([
      kw('blog automation tool', 300, 10),
      kw('blog automation software', 200, 10),
      kw('plumbing repair cost', 400, 10),
      kw('plumbing repair near me', 350, 10),
    ], { ceiling: 30 });

    const all = clusters.flatMap((c) => [c.pillar.keyword, ...c.members.map((m) => m.keyword)]);
    expect(new Set(all).size).toBe(all.length);
    expect(clusters).toHaveLength(2);
  });

  it('is deterministic — the same inputs produce the same plan', () => {
    const input = [
      kw('blog automation tool', 200, 10),
      kw('blog automation software', 150, 12),
      kw('plumbing repair', 900, 20),
    ];
    const a = JSON.stringify(buildClusters(input));
    const b = JSON.stringify(buildClusters([...input].reverse()));
    expect(a).toBe(b);
  });

  it('leaves unscorable keywords as their own clusters rather than hiding them in measured ones', () => {
    // Autocomplete-only rows. They must not silently attach to a scored pillar
    // and inflate a cluster that has no evidence behind them.
    const clusters = buildClusters([
      kw('blog automation tool', 500, 10),
      kw('some unmeasured phrase', null, null),
    ], { ceiling: 30 });

    expect(clusters[0].pillar.keyword).toBe('blog automation tool');
    expect(clusters[0].members).toHaveLength(0);
    expect(clusters[1].pillar.keyword).toBe('some unmeasured phrase');
    expect(clusters[1].score).toBe(0);
  });

  it('clusters Korean keywords end to end', () => {
    const [c] = buildClusters([
      kw('블로그 자동화 도구', 300, 10),
      kw('블로그 자동화 서비스', 200, 12),
      kw('블로그 자동화 가격', 150, 8),
    ], { ceiling: 30 });

    expect(c.pillar.keyword).toBe('블로그 자동화 도구');
    expect(c.members).toHaveLength(2);
    expect(c.totalVolume).toBe(650);
  });
});

describe('formatClustersForPrompt', () => {
  it('states the numbers the planner needs to choose, not just the phrases', () => {
    const [c] = buildClusters([
      kw('blog automation tool', 880, 22),
      kw('blog automation software', 400, 20),
    ], { ceiling: 30 });
    const out = formatClustersForPrompt([c]);

    expect(out).toContain('blog automation tool');
    expect(out).toContain('difficulty 22/100');
    expect(out).toContain('880/mo');
    expect(out).toContain('cluster total 1,280/mo');   // the prize, not the head
    expect(out).toContain('also covers');
  });

  it('omits the cluster total when there is nothing to add up', () => {
    const [c] = buildClusters([kw('lonely keyword', 300, 10)], { ceiling: 30 });
    const out = formatClustersForPrompt([c]);
    expect(out).not.toContain('cluster total');
    expect(out).not.toContain('also covers');
  });

  it('renders unknown metrics as ? rather than inventing a zero', () => {
    const [c] = buildClusters([kw('unmeasured', null, null)]);
    const out = formatClustersForPrompt([c]);
    expect(out).toContain('difficulty ?/100');
    expect(out).toContain('?/mo');
  });

  it('says so when there is no demand at all, instead of emitting an empty block', () => {
    expect(formatClustersForPrompt([])).toContain('no measured demand');
  });
});

describe('the long tail and the floor', () => {
  const kw = (keyword: string, volume: number, difficulty: number) => ({ keyword, volume, difficulty, intent: null, source: 'dataforseo' });

  it('lets members-only phrases join a pillar but never lead a cluster of their own', () => {
    const leads = [kw('publish blog posts', 900, 20)];
    const tail = [kw('publish blog posts automatically', 40, 12), kw('publish blog posts on wordpress', 60, 15), kw('tortilla recipe', 80, 5)];
    const out = buildClusters(leads, { membersOnly: tail });
    expect(out).toHaveLength(1);
    expect(out[0].pillar.keyword).toBe('publish blog posts');
    expect(out[0].members.map((m) => m.keyword).sort()).toEqual(['publish blog posts automatically', 'publish blog posts on wordpress']);
    // 900 + 40 + 60: the tail is what the cluster was built to sum
    expect(out[0].totalVolume).toBe(1000);
    // "tortilla recipe" overlaps nothing, and a member-only phrase cannot start a cluster
    expect(out.some((c) => c.pillar.keyword === 'tortilla recipe')).toBe(false);
  });

  it('drops a cluster whose whole prize is under the floor, and keeps one the tail lifts over it', () => {
    // Two topics that share no token, so the tail can only land where it belongs.
    const leads = [kw('keyword research tools', 200, 10), kw('embed blog no cms', 30, 5)];
    const tail = [kw('embed blog without cms', 45, 6), kw('embed a blog no cms', 40, 6)];
    const out = buildClusters(leads, { membersOnly: tail, minTotalVolume: 100 });
    expect(out.map((c) => [c.pillar.keyword, c.totalVolume])).toEqual([
      ['keyword research tools', 200],
      ['embed blog no cms', 115],   // 30 + 45 + 40 — an article's worth once summed
    ]);
    const strict = buildClusters(leads, { membersOnly: tail, minTotalVolume: 150 });
    expect(strict.map((c) => c.pillar.keyword)).toEqual(['keyword research tools']);
  });

  it('applies no floor by default, so an unmeasured pool still clusters', () => {
    const out = buildClusters([{ keyword: 'a', volume: null, difficulty: null, intent: null, source: 'autocomplete' }]);
    expect(out).toHaveLength(1);
  });
});

describe('close variants — one Ads bucket is one keyword', () => {
  // What trygroveai.com's ledger actually held on 2026-09-13: Labs returned
  // every string in the bucket, each carrying the bucket's volume.
  const dogBlog = [
    'dog with the a blog', 'blog with the dog', 'dog in the blog', 'dog on the blog',
    'dog of the blog', 'dog and the blog', 'dog with the blog', 'dog the blog', 'blog the dog',
  ].map((k) => kw(k, 60_500, 6));

  it('keys a bucket on content tokens + volume, never on word order or stopwords', () => {
    const keys = new Set(dogBlog.map(variantKey));
    expect(keys.size).toBe(1);
  });

  it('keeps same words at a different volume apart — those are different buckets', () => {
    expect(variantKey(kw('content marketing', 110_000, 40)))
      .not.toBe(variantKey(kw('marketing content', 246_000, 40)));
  });

  it('never collapses an unmeasured phrase — no volume, no evidence of a bucket', () => {
    expect(variantKey(kw('dog the blog', null, null))).toBeNull();
    const out = collapseCloseVariants([kw('dog the blog', null, null), kw('blog the dog', null, null)]);
    expect(out).toHaveLength(2);
  });

  it('folds a bucket to its cleanest spelling: fewest words, then shortest', () => {
    const out = collapseCloseVariants([
      kw('content marketing content', 110_000, 40),
      kw('content of marketing', 110_000, 40),
      kw('content for content marketing', 110_000, 40),
      kw('content marketing', 110_000, 40),
    ]);
    expect(out.map((k) => k.keyword)).toEqual(['content marketing']);
  });

  it('prefers the spelling that carries a difficulty over one that does not', () => {
    const out = collapseCloseVariants([kw('content marketing', 110_000, null), kw('marketing of content', 110_000, 40)]);
    expect(out[0].keyword).toBe('marketing of content');
  });

  it('keeps first-seen order and leaves distinct phrases alone', () => {
    const out = collapseCloseVariants([
      kw('seo strategy', 3_600, 30), kw('blog the dog', 60_500, 6), kw('keyword research', 2_900, 35), kw('dog the blog', 60_500, 6),
    ]);
    expect(out.map((k) => k.keyword)).toEqual(['seo strategy', 'blog the dog', 'keyword research']);
  });

  it('counts the bucket ONCE in the cluster total, not once per spelling', () => {
    const [c] = buildClusters(dogBlog);
    expect(c.members).toHaveLength(0);
    expect(c.totalVolume).toBe(60_500);   // was 544,500 — nine spellings summed
  });

  it('drops a tail phrase whose bucket a lead already represents', () => {
    const [c] = buildClusters([kw('content marketing', 110_000, 40)], {
      membersOnly: [kw('content of marketing', 110_000, 40), kw('content marketing tips', 500, 20)],
    });
    expect(c.members.map((m) => m.keyword)).toEqual(['content marketing tips']);
    expect(c.totalVolume).toBe(110_500);
  });

  it('still sums genuinely different searches — the reason clustering exists', () => {
    const [c] = buildClusters([
      kw('blog automation', 1_000, 20), kw('blog automation tool', 400, 25), kw('automate blog posts', 300, 22),
    ]);
    expect(c.totalVolume).toBe(1_700);
  });
});

describe('revealed demand in clusters', () => {
  const seen = { impressions: 627, clicks: 9, position: 13.4, days: 28 };

  it('states what Google already showed the site, beside the purchased figure', () => {
    const [c] = buildClusters([{ ...kw('3d icon generator', 20, 21), revealed: seen }]);
    const text = formatClustersForPrompt([c]);
    expect(text).toContain('20/mo');
    expect(text).toContain('Google already shows this site for it: 627 impressions in 28d at position 13.4');
  });

  it('counts observed demand toward the cluster total when the database has less or nothing', () => {
    const [c] = buildClusters([
      { ...kw('3d icon generator', 20, 21), revealed: seen },
      { ...kw('3d icon generator online', null, null), revealed: { impressions: 56, clicks: 0, position: 33, days: 28 } },
    ]);
    expect(c.totalVolume).toBe(672 + 60);
  });
});
