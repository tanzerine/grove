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
  clicks: number;
  impressions: number;
  ctr: number;           // 0..1
  position: number;
};

/** Top pages by clicks, resolved to post titles where we can. */
export function topContent(
  pages: MetricRow[],
  titleById: Map<string, string>,
  limit = 6,
): ContentRow[] {
  return [...pages]
    .filter((p) => p.impressions > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit)
    .map((p) => {
      let path = p.key;
      try { path = new URL(p.key).pathname; } catch { /* keep raw key */ }
      const title = (p.post_id && titleById.get(p.post_id)) || path;
      return {
        postId: p.post_id ?? null,
        title,
        path,
        clicks: p.clicks,
        impressions: p.impressions,
        ctr: p.impressions > 0 ? Math.round((p.clicks / p.impressions) * 1000) / 1000 : 0,
        position: Math.round(p.position * 10) / 10,
      };
    });
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
