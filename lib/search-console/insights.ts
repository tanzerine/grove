/**
 * Pure Search Console analysis — no I/O, fully unit-tested.
 *
 * Turns raw per-page / per-query metric rows into the two things the loop
 * actually needs:
 *   - a plain-language visibility summary (impressions, clicks, avg position)
 *   - NEAR-WINNERS: pages stuck in "striking distance" (page 2 of Google,
 *     positions ~8-20) that already pull impressions. Pushing one of these
 *     into the top 10 is the single highest-ROI SEO move, so we surface them
 *     to both the owner and the strategist agent.
 */

export type MetricRow = {
  key: string;            // page url or query string
  clicks: number;
  impressions: number;
  position: number;       // average position (1 = top)
  post_id?: string | null;
};

export type NearWinner = {
  key: string;
  post_id: string | null;
  impressions: number;
  clicks: number;
  position: number;
};

export type Visibility = {
  impressions: number;
  clicks: number;
  ctr: number;            // 0..1
  avgPosition: number;    // impression-weighted
  queryCount: number;     // how many distinct queries we appear for
  topQueries: { query: string; impressions: number; clicks: number; position: number }[];
  nearWinners: NearWinner[];
};

/** Impression-weighted average position — a few high-impression pages should
 *  dominate the headline number, not a long tail of zero-impression rows. */
export function weightedPosition(rows: MetricRow[]): number {
  let num = 0, den = 0;
  for (const r of rows) {
    if (r.impressions > 0 && r.position > 0) { num += r.position * r.impressions; den += r.impressions; }
  }
  return den > 0 ? Math.round((num / den) * 10) / 10 : 0;
}

/**
 * Pages on the cusp: ranked between `minPos` and `maxPos` with at least
 * `minImpressions`, sorted by impressions (biggest opportunity first).
 * Defaults target "page 2" — position 8 to 20.
 */
export function nearWinners(
  pages: MetricRow[],
  opts: { minPos?: number; maxPos?: number; minImpressions?: number; limit?: number } = {},
): NearWinner[] {
  const minPos = opts.minPos ?? 8;
  const maxPos = opts.maxPos ?? 20;
  const minImpressions = opts.minImpressions ?? 5;
  const limit = opts.limit ?? 10;
  return pages
    .filter((p) => p.position >= minPos && p.position <= maxPos && p.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map((p) => ({
      key: p.key,
      post_id: p.post_id ?? null,
      impressions: p.impressions,
      clicks: p.clicks,
      position: Math.round(p.position * 10) / 10,
    }));
}

export type RankBand = { label: string; min: number; max: number; count: number };

/** Distribution of query positions across the four dashboard bands. Counts
 *  distinct ranking queries (those with impressions) by average position. */
export function rankingDistribution(queries: MetricRow[]): { bands: RankBand[]; total: number } {
  const defs: { label: string; min: number; max: number }[] = [
    { label: 'Positions 1–3', min: 1, max: 3 },
    { label: 'Positions 4–10', min: 3.0001, max: 10 },
    { label: 'Positions 11–20', min: 10.0001, max: 20 },
    { label: 'Positions 21+', min: 20.0001, max: Infinity },
  ];
  const ranking = queries.filter((q) => q.impressions > 0 && q.position > 0);
  const bands = defs.map((d) => ({
    label: d.label, min: d.min, max: d.max,
    count: ranking.filter((q) => q.position >= d.min && q.position <= d.max).length,
  }));
  return { bands, total: ranking.length };
}

export type ContentRow = {
  postId: string | null;
  title: string;
  path: string;          // url path, shown as the secondary line when no keyword
  views: number;         // first-party tracked reader views (0 until tracking sees one)
  clicks: number;
  impressions: number;
  ctr: number;           // 0..1
  position: number;
};

export type ArticleInfo = { id: string; title: string | null; slug: string | null; reads?: number | null };

/**
 * One row per published article — the dashboard's job is "show me every
 * article's numbers", not "show me my six busiest pages" (which on a young
 * blog is the homepage and /pricing, never the articles).
 *
 * `views` is the article's first-party read counter (posts.reads) — the same
 * per-article number shown on the published list. GSC page rows are folded in
 * by post_id: one post can surface under several URLs (grove-hosted mirror +
 * the customer's own domain), so clicks and impressions are summed and
 * position is impression-weighted across them. Articles Google hasn't
 * surfaced yet still get a row (views only, GSC columns zero).
 */
export function articleRows(
  pages: MetricRow[],
  posts: ArticleInfo[],
): ContentRow[] {
  const byPost = new Map<string, MetricRow[]>();
  for (const p of pages) {
    if (!p.post_id) continue;
    const list = byPost.get(p.post_id) ?? [];
    list.push(p);
    byPost.set(p.post_id, list);
  }

  return posts
    .map((post) => {
      const rows = byPost.get(post.id) ?? [];
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      const impressions = rows.reduce((a, r) => a + r.impressions, 0);
      // secondary line: the URL Google shows most (else the article's own path)
      const busiest = [...rows].sort((a, b) => b.impressions - a.impressions)[0];
      let path = post.slug ? `/${post.slug}` : '';
      if (busiest) { try { path = new URL(busiest.key).pathname; } catch { path = busiest.key; } }
      return {
        postId: post.id,
        title: post.title || path || 'Untitled',
        path,
        views: post.reads ?? 0,
        clicks,
        impressions,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 1000 : 0,
        position: weightedPosition(rows),
      };
    })
    .sort((a, b) =>
      b.clicks - a.clicks || b.impressions - a.impressions ||
      b.views - a.views || a.title.localeCompare(b.title));
}

export function summarize(pages: MetricRow[], queries: MetricRow[]): Visibility {
  const impressions = pages.reduce((a, p) => a + p.impressions, 0);
  const clicks = pages.reduce((a, p) => a + p.clicks, 0);
  const topQueries = [...queries]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 12)
    .map((q) => ({
      query: q.key,
      impressions: q.impressions,
      clicks: q.clicks,
      position: Math.round(q.position * 10) / 10,
    }));
  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 1000 : 0,
    avgPosition: weightedPosition(pages),
    queryCount: queries.filter((q) => q.impressions > 0).length,
    topQueries,
    nearWinners: nearWinners(pages),
  };
}
