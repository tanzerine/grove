/**
 * First-touch signup attribution.
 *
 * Of grove's first 12 signups, none carried any record of where they came
 * from: the only source field was the self-reported "how did you hear about
 * us" answer, asked after the fact. This captures the MEASURED half — the
 * external referrer, the utm_* tags and the page a visitor first landed on —
 * in a first-party cookie the first time a public page is served, and copies
 * it onto the user's metadata when the account is created.
 *
 * First touch, not last: the cookie is written once and never overwritten, so
 * a visitor who found an article through Google and came back a week later by
 * typing the URL is credited to the article. No third-party script, no
 * fingerprint — one cookie on grove's own origin, readable by the signup form.
 *
 * Pure: middleware writes the cookie, AuthForm and /auth/callback read it, and
 * every rule about what goes in it lives here, under test.
 */

export const FIRST_TOUCH_COOKIE = 'gv_ft';
/** 90 days — long enough to span a considered B2B signup. */
export const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 90;

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
type UtmKey = (typeof UTM_KEYS)[number];

export type FirstTouch = {
  /** External referrer URL; absent for direct visits and internal navigation. */
  referrer?: string;
  /** Hostname of the referrer, www-stripped — the field anyone groups by. */
  referrer_host?: string;
  /** Path (no query) of the first page served. */
  landing_path: string;
  /** ISO timestamp of the first visit. */
  first_seen_at: string;
} & Partial<Record<UtmKey, string>>;

/** Caps keep a hostile query string from bloating a cookie sent on every request. */
const MAX_FIELD = 200;
const clip = (s: string) => s.slice(0, MAX_FIELD);
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/**
 * Build the first-touch record for a page request. `appHost` is grove's own
 * host: a referrer from it (or its www twin) is internal navigation, not a
 * source, and is dropped rather than recorded as "trygroveai.com".
 */
export function firstTouchFrom(input: {
  url: string;
  referrer?: string | null;
  appHost?: string | null;
  now?: Date;
}): FirstTouch | null {
  let u: URL;
  try {
    u = new URL(input.url);
  } catch {
    return null;
  }
  const ft: FirstTouch = {
    landing_path: clip(u.pathname || '/'),
    first_seen_at: (input.now ?? new Date()).toISOString(),
  };
  for (const k of UTM_KEYS) {
    const v = u.searchParams.get(k)?.trim();
    if (v) ft[k] = clip(v);
  }
  const ref = (input.referrer ?? '').trim();
  if (ref) {
    try {
      const r = new URL(ref);
      const internal =
        bareHost(r.hostname) === bareHost(u.hostname) ||
        (!!input.appHost && bareHost(r.hostname) === bareHost(input.appHost));
      if (!internal && (r.protocol === 'https:' || r.protocol === 'http:')) {
        ft.referrer = clip(r.href);
        ft.referrer_host = bareHost(r.hostname);
      }
    } catch {
      /* unparseable referrer — record the visit without it */
    }
  }
  return ft;
}

/**
 * The cookie VALUE. Plain JSON on purpose: Next's cookie API percent-encodes
 * on write and decodes on read, so encoding here too would double it. A
 * `document.cookie` read sees the percent-encoded form, a `cookies()` read the
 * decoded one — decodeFirstTouch accepts both.
 */
export function encodeFirstTouch(ft: FirstTouch): string {
  return JSON.stringify(ft);
}

/**
 * Parse a cookie value back into a FirstTouch. Defensive by contract: the
 * cookie is client-controlled, so anything that isn't the expected shape is
 * dropped field by field, and garbage returns null instead of throwing inside
 * a signup.
 */
export function decodeFirstTouch(raw: string | null | undefined): FirstTouch | null {
  if (!raw) return null;
  let v: unknown = undefined;
  for (const attempt of [() => JSON.parse(raw), () => JSON.parse(decodeURIComponent(raw))]) {
    try {
      v = attempt();
      break;
    } catch {
      /* try the next form */
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? clip(x.trim()) : undefined);
  const landing = str(o.landing_path);
  const seen = str(o.first_seen_at);
  if (!landing || !seen || !Number.isFinite(Date.parse(seen))) return null;
  const ft: FirstTouch = { landing_path: landing, first_seen_at: seen };
  const referrer = str(o.referrer);
  const referrerHost = str(o.referrer_host);
  if (referrer) ft.referrer = referrer;
  if (referrerHost) ft.referrer_host = referrerHost;
  for (const k of UTM_KEYS) {
    const val = str(o[k]);
    if (val) ft[k] = val;
  }
  return ft;
}

/**
 * Should middleware stamp a first-touch cookie on this request? Only a real
 * page load a person made: GET, not an API/asset/auth path, not a Next.js
 * prefetch or RSC fetch (those are internal navigation and would carry our own
 * page as the referrer), not a bot, and only when no cookie exists yet.
 */
export function shouldStampFirstTouch(req: {
  method: string;
  pathname: string;
  hasCookie: boolean;
  isBot: boolean;
  isPrefetch: boolean;
}): boolean {
  if (req.hasCookie || req.isBot || req.isPrefetch) return false;
  if (req.method !== 'GET') return false;
  const p = req.pathname;
  if (p.startsWith('/api/') || p.startsWith('/_next') || p.startsWith('/auth/') || p.startsWith('/.well-known')) return false;
  // Signed-in surfaces: a visitor reaching these already has an account.
  if (p.startsWith('/dashboard') || p.startsWith('/onboarding') || p.startsWith('/oauth')) return false;
  // Files, not pages (robots.txt, sitemap.xml, rss.xml, og images, icons).
  if (/\.[a-z0-9]+$/i.test(p) || /\/og$/.test(p)) return false;
  return true;
}

/** Read one cookie out of a `document.cookie`-shaped string. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The user_metadata patch for a signup — `{}` when there is nothing to add. */
export function attributionMetadata(ft: FirstTouch | null): { first_touch?: FirstTouch } {
  return ft ? { first_touch: ft } : {};
}
