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

/**
 * Why a Labs call did or did not produce keywords.
 *
 * This type exists because of a failure this module actually shipped. Every
 * path returned a bare `null`, so "the credentials are not set" and "the API
 * rejected us" were indistinguishable — and when grove's first live plan fell
 * back to autocomplete, nothing anywhere could say which it had been. That is
 * precisely the confusion lib/strategy/seeds.ts spent a paragraph on ("an
 * empty demand list looked identical to a network failure for months"), and
 * the fix there was the same as the fix here: make the distinction a value,
 * not an inference.
 *
 * `reason` is what a human needs to act on, and each one has a different
 * remedy: not_configured is a Vercel env-var scope, http is credentials or an
 * IP whitelist, task is a malformed request or an out-of-funds account, and
 * network is the egress path.
 */
export type LabsOutcome =
  | { ok: true; json: any }
  | { ok: false; reason: 'not_configured' | 'http' | 'task' | 'network'; detail: string };

/**
 * One log line that names the remedy, not just the symptom.
 *
 * Pure, so the message a future operator reads at 2am is unit-tested rather
 * than composed in an untested catch block.
 */
export function describeLabsOutcome(o: LabsOutcome): string {
  if (o.ok) return 'ok';
  switch (o.reason) {
    case 'not_configured':
      return 'DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD not set in this runtime — ' +
             'check the vars are scoped to this environment (Production is a separate checkbox) ' +
             'and that a deploy has happened since they were set';
    case 'http': {
      // A 401 has three plausible causes and they are not equally likely; the
      // double-encoded token is checked first because it is the one that looks
      // like correct credentials to the person who set it.
      const shape = credentialShapeWarning(
        process.env.DATAFORSEO_LOGIN ?? '', process.env.DATAFORSEO_PASSWORD ?? '',
      );
      if (shape) return `DataForSEO returned ${o.detail} — ${shape}`;
      return `DataForSEO returned ${o.detail} — a 401 means the API password ` +
             '(from the API CREDENTIALS block, not the dashboard sign-in password); ' +
             'a 403 often means the account\'s IP whitelist excludes this host';
    }
    case 'task':
      return `DataForSEO accepted the request but the task failed: ${o.detail} — ` +
             'usually a malformed field or an account out of funds';
    case 'network':
      return `could not reach DataForSEO: ${o.detail} — egress or timeout`;
  }
}

/**
 * Catch the credential mix-up that cost grove its first live run.
 *
 * DataForSEO's dashboard shows the raw login and password AND a ready-made
 * `Authorization: Basic <token>` example, where the token is
 * base64("login:password"). Pasting that token into the password field looks
 * entirely plausible — it is long, opaque and sits next to the thing you want.
 * The client then base64s it a second time together with the login, and the
 * API answers 40100 "not authorized", which reads as wrong credentials rather
 * than as double-encoded ones.
 *
 * Detected by decoding: if the password is base64 whose plaintext starts with
 * this very login followed by a colon, it is the token, not the password.
 * Deliberately narrow — it must match the configured login — so an ordinary
 * password that happens to be base64-shaped never trips it.
 *
 * Pure, and returns null when there is nothing to say.
 */
export function credentialShapeWarning(login: string, password: string): string | null {
  if (!login || !password) return null;
  if (password.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(password)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(password, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const [maybeLogin, ...rest] = decoded.split(':');
  if (!rest.length || maybeLogin.toLowerCase() !== login.toLowerCase()) return null;
  return 'DATAFORSEO_PASSWORD looks like the base64 "Authorization: Basic" TOKEN ' +
         '(it decodes to your own login + ":" + password), not the password itself. ' +
         'Use the API password from the API CREDENTIALS block on its own — this client ' +
         'does the base64 encoding for you, so passing the token double-encodes it.';
}

/** Collapse a batch into one line, so a 30-seed run logs once rather than 30 times. */
export function summarizeLabsOutcomes(outcomes: LabsOutcome[]): string {
  if (!outcomes.length) return 'no calls made';
  const ok = outcomes.filter((o) => o.ok).length;
  if (ok === outcomes.length) return `ok (${ok}/${outcomes.length})`;
  // Report the first failure in full: in practice a batch fails the same way
  // every time, and one actionable sentence beats thirty truncated ones.
  const first = outcomes.find((o) => !o.ok)!;
  return `${ok}/${outcomes.length} succeeded — ${describeLabsOutcome(first)}`;
}

async function labsCall(path: string, body: unknown[], timeoutMs: number): Promise<LabsOutcome> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    const missing = [!login && 'DATAFORSEO_LOGIN', !password && 'DATAFORSEO_PASSWORD']
      .filter(Boolean).join(' + ');
    return { ok: false, reason: 'not_configured', detail: `missing ${missing}` };
  }

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
    if (!res.ok) {
      // The body often names the real problem where the status alone does not.
      // Bounded, because an error page can be enormous and this reaches logs.
      let hint = '';
      try { hint = (await res.text()).slice(0, 200).replace(/\s+/g, ' ').trim(); } catch { /* body already consumed */ }
      return { ok: false, reason: 'http', detail: `HTTP ${res.status}${hint ? ` — ${hint}` : ''}` };
    }
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, reason: 'network', detail: String((e as Error)?.message ?? e) };
  }
}

/**
 * Read the per-task status DataForSEO reports INSIDE a 200 response.
 *
 * Separate from the HTTP check because a failed task arrives with HTTP 200,
 * so `res.ok` alone would report success for a request that returned nothing.
 */
function taskOutcome(json: any): LabsOutcome {
  const task = json?.tasks?.[0];
  if (!task) return { ok: false, reason: 'task', detail: 'no task in response' };
  if (typeof task.status_code === 'number' && task.status_code !== 20000) {
    return { ok: false, reason: 'task', detail: `${task.status_code} ${task.status_message ?? ''}`.trim() };
  }
  return { ok: true, json };
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
  const { keywords } = await keywordSuggestionsDetailed(seed, lang, opts);
  return keywords;
}

/**
 * The same call, but it also says WHY when it comes back empty. The planner
 * uses this one so a fallback to autocomplete can be logged with its cause
 * instead of appearing as an unexplained absence of demand.
 */
export async function keywordSuggestionsDetailed(
  seed: string,
  lang: LangCode,
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<{ keywords: ScoredKeyword[] | null; outcome: LabsOutcome }> {
  const call = await labsCall('/v3/dataforseo_labs/google/keyword_suggestions/live', [{
    keyword: seed,
    language_code: lang,
    location_code: LOCATION[lang] ?? LOCATION.en,
    limit: opts.limit ?? 200,
    include_seed_keyword: true,
    include_serp_info: false,
  }], opts.timeoutMs ?? 20_000);
  if (!call.ok) return { keywords: null, outcome: call };
  // A 200 can still carry a failed task, so the task status is the real result.
  const task = taskOutcome(call.json);
  if (!task.ok) return { keywords: null, outcome: task };
  return { keywords: parseLabsResponse(call.json), outcome: task };
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
  const call = await labsCall('/v3/dataforseo_labs/google/keyword_overview/live', [{
    keywords: list,
    language_code: lang,
    location_code: LOCATION[lang] ?? LOCATION.en,
  }], opts.timeoutMs ?? 20_000);
  if (!call.ok) return null;
  return parseLabsResponse(call.json);
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
  if (!seeds.length) return null;
  if (!dataforseoConfigured()) {
    console.warn(`[dataforseo] ${describeLabsOutcome({ ok: false, reason: 'not_configured', detail: '' })}`);
    return null;
  }
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 25));

  const out = new Map<string, ScoredKeyword>();
  const outcomes: LabsOutcome[] = [];
  let anySucceeded = false;

  for (let i = 0; i < seeds.length; i += concurrency) {
    const batch = seeds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((s) => keywordSuggestionsDetailed(s, lang, { limit: opts.perSeed ?? 200 })),
    );
    for (const { keywords, outcome } of results) {
      outcomes.push(outcome);
      if (keywords == null) continue;
      anySucceeded = true;
      for (const k of keywords) {
        const key = k.keyword.toLowerCase();
        const prev = out.get(key);
        // Keep the richer record when the same phrase arrives from two seeds.
        if (!prev || (prev.volume == null && k.volume != null)) out.set(key, k);
      }
    }
  }

  // One line, always — a silent success is as hard to debug as a silent
  // failure when the question is "did the paid source actually get used".
  const summary = summarizeLabsOutcomes(outcomes);
  if (anySucceeded) console.info(`[dataforseo] ${out.size} keywords from ${seeds.length} seeds — ${summary}`);
  else console.warn(`[dataforseo] no keywords — ${summary}`);

  return anySucceeded ? [...out.values()] : null;
}
