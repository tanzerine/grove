import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The screen exists because a plan for grove's own blog came back targeting
 * "dog with the blog cast" and "blog the dog" — the highest-volume phrases
 * sharing a word with the seeds. These fixtures are that plan's clusters, so
 * the test asks the exact question production failed to.
 */
vi.mock('../lib/llm', () => ({
  llmCall: vi.fn(),
  extractJson: (text: string) => JSON.parse(text),
}));
import { llmCall } from '../lib/llm';
import { describeClusters, parseVerdicts, applyVerdicts, screenClusters } from '../lib/keywords/relevance';
import type { KeywordCluster } from '../lib/keywords/cluster';

const kw = (keyword: string, volume: number, difficulty: number): KeywordCluster['pillar'] =>
  ({ keyword, volume, difficulty, intent: 'informational', source: 'dataforseo' });

const cluster = (pillar: string, volume: number, kd: number, members: string[] = []): KeywordCluster => ({
  pillar: kw(pillar, volume, kd),
  members: members.map((m) => kw(m, 100, kd)),
  totalVolume: volume + members.length * 100,
  difficulty: kd,
  score: volume,
});

const CLUSTERS: KeywordCluster[] = [
  cluster('blog the dog', 60500, 9, ['dog and the blog', 'dog on the blog']),
  cluster('content marketing agency', 3600, 15, ['agency content marketing', 'content marketing agencies']),
  cluster('dog with the blog cast', 33100, 6, ['cast of dog with the blog', 'what is the blog']),
  cluster('content marketing for b2b', 1900, 18),
  cluster('harriet the spy: blog wars movie', 1900, 3),
];

const BIZ = { name: 'Grove', description: 'An agentic SEO blog for small SaaS companies.', products_services: ['Autonomous AI blog writing'] };

describe('describeClusters', () => {
  it('numbers the clusters from 1 and shows at most four members', () => {
    const lines = describeClusters([cluster('a', 1, 1, ['m1', 'm2', 'm3', 'm4', 'm5']), cluster('b', 1, 1)]).split('\n');
    expect(lines[0]).toBe('C1. "a" — also: m1, m2, m3, m4');
    expect(lines[1]).toBe('C2. "b"');
  });
});

describe('parseVerdicts', () => {
  it('drops only on an explicit relevant:false, and carries the reason', () => {
    const drop = parseVerdicts({ verdicts: [
      { c: 1, relevant: false, why: 'a Disney series' },
      { c: 2, relevant: true },
      { c: 3 },                              // no verdict → keep
      { c: 4, relevant: 'no' },              // not a boolean false → keep
    ] }, 5);
    expect([...drop.entries()]).toEqual([[1, 'a Disney series']]);
  });

  it('tolerates a bare array, string numbers and alternate keys', () => {
    const drop = parseVerdicts([{ cluster: '2', relevant: false }, { id: 3, relevant: false, why: '' }], 3);
    expect(drop.get(2)).toBe('off topic');
    expect(drop.get(3)).toBe('off topic');
  });

  it('ignores out-of-range and malformed entries rather than dropping the wrong cluster', () => {
    const drop = parseVerdicts({ verdicts: [{ c: 0, relevant: false }, { c: 9, relevant: false }, null, 'x', { c: 'two', relevant: false }] }, 3);
    expect(drop.size).toBe(0);
  });

  it('keeps everything for an unparseable answer', () => {
    expect(parseVerdicts('nonsense', 3).size).toBe(0);
    expect(parseVerdicts(null, 3).size).toBe(0);
  });
});

describe('applyVerdicts', () => {
  it('splits by 1-based cluster number and preserves order', () => {
    const out = applyVerdicts(CLUSTERS, new Map([[1, 'tv'], [3, 'tv'], [5, 'film']]));
    expect(out.kept.map((c) => c.pillar.keyword)).toEqual(['content marketing agency', 'content marketing for b2b']);
    expect(out.dropped.map((d) => `${d.cluster.pillar.keyword}:${d.why}`)).toEqual(['blog the dog:tv', 'dog with the blog cast:tv', 'harriet the spy: blog wars movie:film']);
  });
});

describe('screenClusters', () => {
  afterEach(() => vi.restoreAllMocks());

  it('removes the sitcom and keeps the customer\'s problem, whatever the volume', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(llmCall).mockResolvedValueOnce({
      text: JSON.stringify({ verdicts: [
        { c: 1, relevant: false, why: 'dog with a blog, the TV series' },
        { c: 2, relevant: true },
        { c: 3, relevant: false, why: 'the TV series cast' },
        { c: 4, relevant: true },
        { c: 5, relevant: false, why: 'a film' },
      ] }),
      usage: {} as any,
    });
    const out = await screenClusters(CLUSTERS, { business: BIZ, icp: null });
    expect(out.failed).toBe(false);
    expect(out.kept.map((c) => c.pillar.keyword)).toEqual(['content marketing agency', 'content marketing for b2b']);
    expect(out.dropped).toHaveLength(3);
    // The reasons reach the log — that is how "why was this passed over" gets answered.
    expect(String(warn.mock.calls[0][0])).toMatch(/dropped 3 of 5.*blog the dog.*TV series/);
    // The model sees the business and every cluster, numbered.
    const call = vi.mocked(llmCall).mock.calls[0][0];
    expect(call.user).toContain('Grove');
    expect(call.user).toContain('C3. "dog with the blog cast"');
  });

  it('keeps every cluster and says so when the model cannot be consulted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(llmCall).mockRejectedValueOnce(new Error('timeout'));
    const out = await screenClusters(CLUSTERS, { business: BIZ, icp: null });
    expect(out.failed).toBe(true);
    expect(out.kept).toHaveLength(5);
    expect(out.dropped).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toMatch(/screen failed.*keeping every cluster.*timeout/);
  });

  it('does nothing for an empty pool', async () => {
    const out = await screenClusters([], { business: BIZ });
    expect(out).toEqual({ kept: [], dropped: [], failed: false });
    expect(llmCall).not.toHaveBeenCalled();
  });
});
