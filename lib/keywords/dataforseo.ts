/**
 * DataForSEO Labs — the volume and difficulty numbers grove has never had.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 * Google Autocomplete is a HEAD-TERM service with a measured four-word ceiling
 * (see lib/strategy/seeds.ts). That is a structural problem, not a quality
 * one: the keywords worth targeting are the ones few people type, and
 * Autocomplete only returns the ones many people type, so the candidate pool
 * reaching the planner has been filtered by popularity — selected AGAINST the
 * strategy. Labs `keyword_suggestions` expands "before, after, or WITHIN" a
 * seed, and infix expansion is exactly what Autocomplete cannot do.
 *
 * ── Cost shape, which decides the call pattern ─────────────────────────────
 * Labs bills $0.012/task + $0.00012/result. The task fee is 100x the result
 * fee, so ONE call returning 1,000 keywords costs $0.132 while 1,000
 * single-keyword calls cost $12.12. Batch wide, call rarely. Monthly planning
 * per domain lands around $0.15-0.25 — noise against the LLM spend for the
 * articles it plans.
 * (The same arithmetic rules out Keywords Data API: google_ads/search_volume
 * is $0.09/task, 7.5x the Labs task fee, for strictly less data.)
 *
 * ── Fail-soft, like every other external call here ─────────────────────────
 * Unset credentials or any failure returns null — NOT an empty list. The
 * distinction is the whole point: [] means "asked, nothing there" and null
 * means "never asked", and conflating them is the bug lib/strategy/seeds.ts
 * documents, where an empty demand list was indistinguishable from a network
 * failure for months. Callers decide what to do with null; they must not
 * silently plan as though the answer were "no demand".
 *
 * NOT VERIFIED AGAINST THE LIVE API. grove's remote sandboxes block
 * dataforseo.com, so the request shape below is written from the published
 * docs and the response parsing is unit-tested against recorded fixtures —
 * but nobody has yet watched this succeed. Run scripts/keyword-source-compare.ts
 * locally before trusting it in the planner.
 */
import type { SearchIntent } from '../strategy/keywords';
import type { ScoredKeyword } from './opportunity';
import type { LangCode } from '../language';

const BASE = 'https://api.dataforseo.com';
const SANDBOX = 'https://sandbox.dataforseo.com';

/** DataForSEO location codes for the languages grove publishes in. */
const LOCATION: Record<LangCode, number> = { en: 2840, ko: 2410, es: 2724, zh: 2156 };

export function dataforseoConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

/**
 * Map one Labs item to grove's shape.
 *
 * Pure and exported so the field mapping is testable without the network —
 * which matters more than usual here, because a silently-wrong path (reading
 * `keyword_info.competition`, a 0-1 paid-search figure, where
 * `keyword_properties.keyword_difficulty`, a 0-100 organic figure, was meant)
 * yields plausible numbers on a scale that is off by 100x and would quietly
 * pass every keyword through the difficulty gate.
 */
export function parseLabsItem(item: any): ScoredKeyword | null {
  const keyword = typeof item?.keyword === 'string' ? item.keyword.trim() : '';
  if (!keyword) return null;

  const info = item?.keyword_info ?? {};
  const props = item?.keyword_properties ?? {};

  const rawVolume = info?.search_volume;
  const rawKd = props?.keyword_difficulty;

  const intentRaw = item?.search_intent_info?.main_intent ?? null;
  const intent: SearchIntent | null =
    intentRaw === 'informational' || intentRaw === 'commercial' ||
    intentRaw === 'transactional' || intentRaw === 'navigational' ? intentRaw : null;

  return {
    keyword,
    volume: typeof rawVolume === 'number' && Number.isFinite(rawVolume) ? rawVolume : null,
    // Out-of-range means a changed scale or the wrong field; treat it as
    // unknown rather than screening against a number we do not understand.
    difficulty:
      typeof rawKd === 'number' && Number.isFinite(rawKd) && rawKd >= 0 && rawKd <= 100
        ? Math.round(rawKd)
        : null,
    intent,
    source: 'dataforseo',
  };
}

/**
 * Pull the items out of a Labs envelope.
 *
 * DataForSEO returns HTTP 200 with per-task errors in the body, so the task's
 * own status_code is the real result and checking `res.ok` alone would treat a
 * failed task as an empty one.
 */
export function parseLabsResponse(json: any): ScoredKeyword[] | null {
  const task = json?.tasks?.[0];
  if (!task) return null;
  if (typeof task.status_code === 'number' && task.status_code !== 20000) return null;
  const items = task?.result?.[0]?.items;
  if (!Array.isArray(items)) return null;
  return items.map(parseLabsItem).filter((k: ScoredKeyword | null): k is ScoredKeyword => !!k);
}

async function labsCall(path: string, body: unknown[], timeoutMs: number): Promise<any | null> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;

  // The sandbox echoes fixtures rather than data. Useful for wiring, useless
  // for planning — so it is opt-in and never the default.
  const base = process.env.GROVE_DFS_SANDBOX === '1' ? SANDBOX : BASE;
  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Expand one seed into candidate keywords carrying volume and difficulty.
 * Null on any failure — see the fail-soft note at the top of this file.
 */
export async function keywordSuggestions(
  seed: string,
  lang: LangCode,
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<ScoredKeyword[] | null> {
  const json = await labsCall('/v3/dataforseo_labs/google/keyword_suggestions/live', [{
    keyword: seed,
    language_code: lang,
    location_code: LOCATION[lang] ?? LOCATION.en,
    limit: opts.limit ?? 200,
    include_seed_keyword: true,
    include_serp_info: false,
  }], opts.timeoutMs ?? 20_000);
  return json ? parseLabsResponse(json) : null;
}

/**
 * Fill in volume/difficulty for keywords we already have — the GSC queries a
 * domain already ranks for, or an owner's own list. Those are the strongest
 * candidates grove has (proven demand on this exact site) and until now
 * nothing could size them.
 */
export async function keywordOverview(
  keywords: string[],
  lang: LangCode,
  opts: { timeoutMs?: number } = {},
): Promise<ScoredKeyword[] | null> {
  const list = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 700);
  if (!list.length) return [];
  const json = await labsCall('/v3/dataforseo_labs/google/keyword_overview/live', [{
    keywords: list,
    language_code: lang,
    location_code: LOCATION[lang] ?? LOCATION.en,
  }], opts.timeoutMs ?? 20_000);
  return json ? parseLabsResponse(json) : null;
}

/**
 * Every seed, deduped, best-effort.
 *
 * Returns null only when NOTHING came back — one seed failing among several is
 * a partial result, not a failure, and losing the rest of the month's research
 * to it would be the wrong trade. Concurrency is bounded because Labs caps
 * simultaneous requests at 30 and grove fans out across domains.
 */
export async function gatherLabsDemand(
  seeds: string[],
  lang: LangCode,
  opts: { perSeed?: number; concurrency?: number } = {},
): Promise<ScoredKeyword[] | null> {
  if (!dataforseoConfigured() || !seeds.length) return null;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 25));

  const out = new Map<string, ScoredKeyword>();
  let anySucceeded = false;

  for (let i = 0; i < seeds.length; i += concurrency) {
    const batch = seeds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((s) => keywordSuggestions(s, lang, { limit: opts.perSeed ?? 200 })),
    );
    for (const r of results) {
      if (r == null) continue;
      anySucceeded = true;
      for (const k of r) {
        const key = k.keyword.toLowerCase();
        const prev = out.get(key);
        // Keep the richer record when the same phrase arrives from two seeds.
        if (!prev || (prev.volume == null && k.volume != null)) out.set(key, k);
      }
    }
  }

  return anySucceeded ? [...out.values()] : null;
}
