/**
 * Site profiler — crawls the customer's site once, extracts business details
 * AND brand voice, stores both as one rich JSON on the domain row.
 *
 * This is the context EVERY article writer call uses. Without it, the model
 * has no idea what the business does and produces generic, off-topic drafts.
 */
import { llmCall, extractJson } from '../llm';
import { safeFetch } from '../net/ssrf';
import { extractSiteDesign, type SiteDesign } from '../site-design';
import {
  type BrandColors,
  hexToHsl, darkenHex, deriveBrandColors,
} from '../blog-theme';

export type { BrandColors };

export type SiteProfile = {
  business: {
    name: string;
    industry: string;
    description: string;            // 2-3 sentence summary of what they do
    products_services: string[];
    target_audience: string;
    value_props: string[];
    geography: string;              // "global", "US/Canada", "Korea", etc.
  };
  voice: {
    persona: string;                // "engineer-to-engineer, blunt about trade-offs"
    tone: string;
    register: string;
    vocabulary: string[];           // distinctive words/phrases the brand uses
    // ── richer voice signature (brand-review framework) ──────────────────
    we_are: string[];               // what the voice IS, in practice
    we_are_not: string[];           // common misreadings to avoid
    signature_moves: string[];      // recurring rhetorical habits (e.g. "opens with a failure")
    avoid: string[];                // words/phrases this brand never uses
    samples: string[];              // 2-3 REAL prose excerpts from the brand's own blog
  };
  branding: BrandColors | null;
  /** Fonts, palette and navigation captured from the homepage, for the blogs
      grove HOSTS — those have no page to measure. See lib/site-design.ts. */
  design: SiteDesign | null;
  /** When `design` was last captured (ISO). Drives the refresh order in
      /api/cron/domains; absent on profiles written before that cron existed,
      which is exactly the set that should be re-captured first. */
  design_captured_at?: string | null;
  meta: {
    has_blog: boolean;
    has_pricing: boolean;
    pages_crawled: string[];
  };
};

// ─── brand-color extraction helpers ─────────────────────────────────────────

function isInteresting(hex: string): boolean {
  const hsl = hexToHsl(hex);
  return !!hsl && hsl.l>=8 && hsl.l<=90 && hsl.s>=10;
}

/** Normalize a CSS color token (#abc, #aabbcc, rgb(), rgba()) to 6-digit hex. */
function cssColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (hex) {
    const h = hex[1];
    return '#' + (h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h);
  }
  const rgb = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (parts.some((n) => n > 255)) return null;
    return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

const COLOR_TOKEN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}[^)]*\)/g;

/** Every color token in a chunk of CSS text, normalized to hex. */
function collectColors(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(COLOR_TOKEN)) {
    const hex = cssColorToHex(m[0]);
    if (hex) out.push(hex);
  }
  return out;
}

/**
 * Colors used as backgrounds in inline style="" attributes. Buttons and hero
 * sections on JS-framework sites (Tailwind arbitrary values, styled JSX) often
 * carry the brand color here rather than in a <style> block.
 */
function collectInlineBackgroundColors(html: string): string[] {
  const out: string[] = [];
  for (const attr of html.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    for (const decl of attr[1].matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)) {
      const hex = cssColorToHex(decl[1].match(COLOR_TOKEN)?.[0] ?? decl[1]);
      if (hex) out.push(hex);
    }
  }
  return out;
}

/**
 * How likely a color is to BE the brand, from how saturated it is and how often
 * the site uses it.
 *
 * Frequency dominates, and it did not used to. The old blend was
 * `saturation + 10·log2(1+n)`, which weighted saturation linearly and count only
 * gently — so one appearance of a 100%-saturated color scored 110 and beat a
 * 46%-saturated color used sixteen times, at 87. On grove's own homepage that
 * elected `--gv-red-text` — the ERROR color, present exactly once in the whole
 * stylesheet — as the secondary brand color, and the dashboard turns the
 * secondary into the CTA button. Every blog banner offered readers a salmon pink
 * button.
 *
 * Saturation is really a filter — it says "this is a color at all", which
 * isInteresting already gates on. Repetition is the actual evidence of a system:
 * a brand color appears on buttons, links, borders and section fills; an error
 * state, a third-party logo and an illustration tint appear once or twice.
 */
function brandScore(saturation: number, uses: number): number {
  return saturation * 0.6 + 25 * Math.log2(1 + uses);
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

const SYSTEM_FONTS = /^(arial|helvetica|times new roman|times|georgia|verdana|courier|courier new|trebuchet|impact|palatino|garamond|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|inherit|initial|unset)/i;

/**
 * Extract brand colors and heading font from raw homepage HTML. `externalCss`
 * is the concatenated text of the page's linked stylesheets — modern sites
 * (Tailwind, CSS modules) rarely inline any CSS, so without it extraction
 * almost always came back null and blogs fell back to Grove's own palette.
 */
export function extractBrandColors(html: string, externalCss = ''): BrandColors | null {
  try {
    // meta theme-color
    const themeColor = html.match(
      /<meta[^>]*name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i
    )?.[1]?.toLowerCase() ?? null;

    // all <style> block text + linked stylesheets
    const styleText = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map(m => m[1]).join('\n') + '\n' + externalCss;

    // CSS custom properties with semantic brand names (deduped, order kept)
    const brandVarColors: string[] = [];
    for (const m of styleText.matchAll(
      /--(primary|brand|accent|main|key|cta|action|button|hero|highlight|link)[-\w]*\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/gi
    )) {
      const hex = cssColorToHex(m[2]);
      if (hex && !brandVarColors.includes(hex)) brandVarColors.push(hex);
    }

    // every color in CSS + inline style backgrounds, frequency-counted: a brand
    // color repeats across buttons/links/sections, a one-off illustration tint
    // doesn't.
    const counts = new Map<string, number>();
    for (const c of [...collectColors(styleText), ...collectInlineBackgroundColors(html)]) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const scored = [...counts.keys()]
      .filter(isInteresting)
      .map(c => ({ c, hsl: hexToHsl(c)!, n: counts.get(c)! }))
      .filter(x => x.hsl)
      .sort((a, b) => brandScore(b.hsl.s, b.n) - brandScore(a.hsl.s, a.n));

    const primary = brandVarColors[0] ?? themeColor ?? scored[0]?.c ?? null;
    if (!primary) return null;

    // secondary: a genuinely different hue when the site has one (≥40° away),
    // else the next strongest color, else a darker shade of primary.
    const pHsl = hexToHsl(primary);
    const others = scored.filter(x => x.c !== primary);
    const secondary =
      brandVarColors.find(c => c !== primary)
      ?? (pHsl ? others.find(x => x.hsl.s >= 25 && hueDistance(x.hsl.h, pHsl.h) >= 40)?.c : undefined)
      ?? others[0]?.c
      ?? darkenHex(primary, 0.3);

    // pick button color: a different interesting color or fall back to primary
    const btnColor = brandVarColors.find(c => c!==primary)
      ?? others[0]?.c
      ?? primary;

    // heading font: h1/h2/h3 rule or first @font-face
    const headingRuleFont = styleText.match(
      /h[123][^{]*\{[^}]*font-family\s*:\s*['"]?([^;,'"}\n]+)/i
    )?.[1]?.trim();
    const fontFaceFont = styleText.match(
      /@font-face\s*\{[^}]*font-family\s*:\s*['"]([^'"]+)['"]/i
    )?.[1]?.trim();
    const headingFont = [headingRuleFont, fontFaceFont].find(
      f => f && !SYSTEM_FONTS.test(f.trim())
    ) ?? null;

    // Same derivation the manual color-picker uses, so crawled and hand-picked
    // palettes produce identical banner/button colors.
    return deriveBrandColors(primary, { secondary, btn: btnColor, headingFont });
  } catch { return null; }
}

/** Fetch homepage HTML (raw, before stripping) for brand-color extraction. */
async function fetchHomepageRaw(hostname: string): Promise<{ html: string; base: string } | null> {
  for (const base of [`https://${hostname}`, `https://www.${hostname.replace(/^www\./,'')}`]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      // safeFetch validates every redirect hop (SSRF: owner-controlled host)
      const r = await safeFetch(base, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'grove-profiler/1.0 (+https://grove.so)' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      if (!(r.headers.get('content-type')??'').includes('text/html')) continue;
      // r.url = post-redirect URL — relative stylesheet hrefs resolve against it
      return { html: await r.text(), base: r.url || base };
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Fetch the page's linked stylesheets (capped: 4 sheets, ~150KB each) so
 * extraction sees the CSS that actually styles the site. Every URL passes the
 * same SSRF gate as the page itself — stylesheet hrefs are attacker-influenced.
 */
async function fetchExternalCss(html: string, baseUrl: string): Promise<string> {
  const hrefs: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href && !hrefs.includes(href)) hrefs.push(href);
  }
  const sheets: string[] = [];
  for (const href of hrefs.slice(0, 4)) {
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      // safeFetch validates every redirect hop (SSRF: attacker-influenced href)
      const r = await safeFetch(url.toString(), {
        signal: ctrl.signal,
        headers: { 'user-agent': 'grove-profiler/1.0 (+https://grove.so)' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('css') && !url.pathname.endsWith('.css')) continue;
      sheets.push((await r.text()).slice(0, 150_000));
      if (sheets.join('').length > 400_000) break;
    } catch { /* skip sheet */ }
  }
  return sheets.join('\n');
}

/**
 * Just the design capture, without the crawl or the LLM call.
 *
 * profileSite() is expensive — a dozen page fetches and a main-model call —
 * and it only ever runs when a domain has NO profile at all
 * (lib/pipeline/generate.ts). Every domain that existed before design capture
 * shipped already has `business.name`, so nothing would have re-profiled them
 * and `site_profile.design` would have stayed null on every live blog forever.
 *
 * This is the backfill: one homepage fetch plus its stylesheets, which is all
 * extractSiteDesign needs. Cheap enough to run opportunistically, so a blog
 * heals itself on its next generation instead of waiting for someone to notice.
 */
export async function captureSiteDesign(hostname: string): Promise<SiteDesign | null> {
  return (await captureSiteLook(hostname)).design;
}

/**
 * The design capture AND the brand palette, from one homepage fetch.
 *
 * They were split, and only `design` had a refresh path (/api/cron/domains).
 * `branding` was written once, by the profile crawl that runs only when a
 * domain has no profile at all — so an improvement to the extractor reached
 * exactly nobody, and a palette that was wrong on the day it was captured
 * stayed wrong forever. That is not hypothetical: grove's own row held its
 * ERROR red as the brand's secondary color, which the dashboard turns into the
 * CTA button, for as long as the row had existed.
 *
 * Both come out of the same two requests, so refreshing them together costs
 * nothing over refreshing one.
 */
export async function captureSiteLook(
  hostname: string,
): Promise<{ design: SiteDesign | null; branding: BrandColors | null }> {
  const homepage = await fetchHomepageRaw(hostname);
  if (!homepage) return { design: null, branding: null };
  const css = await fetchExternalCss(homepage.html, homepage.base);
  return {
    design: extractSiteDesign(homepage.html, css, homepage.base),
    branding: extractBrandColors(homepage.html, css),
  };
}

const CANDIDATE_PATHS = [
  '', '/', '/about', '/about-us', '/who-we-are',
  '/pricing', '/plans',
  '/products', '/product', '/services', '/solutions', '/features',
  '/contact', '/team',
  '/blog',
];

async function fetchText(url: string): Promise<{ url: string; title: string; meta: string; body: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    // safeFetch validates every redirect hop (SSRF: owner-controlled host)
    const r = await safeFetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'grove-profiler/1.0 (+https://grove.so)' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').trim();
    const metaDesc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? '').trim();
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4_500);
    if (body.length < 100) return null;
    return { url, title, meta: metaDesc, body };
  } catch { return null; }
}

/**
 * Find the brand's own blog posts and pull real prose excerpts. These become
 * the writer's few-shot voice anchors — far stronger than any adjective the
 * extractor could guess from a landing page. Without this, Grove learns voice
 * from marketing copy and writes generic SEO-affiliate prose (the exact failure
 * mode seen on oveners.com).
 */
async function discoverBlogSamples(hostname: string): Promise<string[]> {
  const bases = [`https://${hostname}`, `https://www.${hostname.replace(/^www\./, '')}`];
  for (const base of bases) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      // safeFetch validates every redirect hop (SSRF: owner-controlled host)
      const r = await safeFetch(`${base}/blog`, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'grove-profiler/1.0 (+https://grove.so)' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const html = await r.text();
      // grab post links: /blog/<slug> or /b/<slug>/<post>
      const links = Array.from(html.matchAll(/href=["'](\/(?:blog|b)\/[^"'#?]+)["']/gi))
        .map((m) => m[1])
        .filter((p) => p.split('/').filter(Boolean).length >= 2); // not the index itself
      const unique = Array.from(new Set(links)).slice(0, 3);
      const samples: string[] = [];
      for (const path of unique) {
        const page = await fetchText(`${base}${path}`);
        if (!page) continue;
        // take the densest ~600-char window of real prose as the excerpt
        const excerpt = page.body.replace(/\s+/g, ' ').trim().slice(0, 700);
        if (excerpt.length > 200) samples.push(excerpt);
        if (samples.length >= 2) break;
      }
      if (samples.length) return samples;
    } catch { /* try next base */ }
  }
  return [];
}

export async function profileSite(hostname: string): Promise<SiteProfile> {
  const base = `https://${hostname}`;
  const altBase = `https://www.${hostname.replace(/^www\./, '')}`;

  // try both apex and www, dedupe URLs
  const urls = Array.from(new Set([
    ...CANDIDATE_PATHS.map((p) => `${base}${p}`),
    ...CANDIDATE_PATHS.map((p) => `${altBase}${p}`),
  ]));

  const [pagesResults, blogSamples, homepage] = await Promise.all([
    Promise.all(urls.map(fetchText)),
    discoverBlogSamples(hostname),
    fetchHomepageRaw(hostname),
  ]);
  const pages = pagesResults.filter((p): p is NonNullable<typeof p> => !!p);
  const externalCss = homepage ? await fetchExternalCss(homepage.html, homepage.base) : '';
  const branding = homepage ? extractBrandColors(homepage.html, externalCss) : null;
  const design = homepage ? extractSiteDesign(homepage.html, externalCss, homepage.base) : null;

  // Always include the homepage even if empty
  if (!pages.length) {
    return blankProfile(hostname, [], false, false, branding, design);
  }

  const crawledUrls = pages.map((p) => p.url);
  const hasBlog = pages.some((p) => /\/blog/.test(p.url));
  const hasPricing = pages.some((p) => /\/(pricing|plans)/i.test(p.url));

  // Cap total corpus to keep tokens reasonable
  const corpus = pages.slice(0, 6).map((p) =>
    `## ${p.url}\nTITLE: ${p.title}\nMETA: ${p.meta}\nBODY: ${p.body}`
  ).join('\n\n---\n\n').slice(0, 24_000);

  // Voice is the highest-leverage field in the whole pipeline, so this runs on
  // the MAIN model (not the 3B fast model) and is anchored on real blog prose.
  const samplesBlock = blogSamples.length
    ? blogSamples.map((s, i) => `SAMPLE ${i + 1}:\n"""${s}"""`).join('\n\n')
    : '(no blog samples found — infer voice from the marketing copy, but mark it low-confidence)';

  const { text } = await llmCall({
    json: true,
    maxTokens: 2000,
    system: `You analyze a website and extract structured business intelligence AND a
precise brand-voice signature a ghostwriter could imitate.

Be specific. "professional" is useless — "engineer-to-engineer, blunt about trade-offs" is useful.
If a field is genuinely unknown, write "unknown" — never invent.

VOICE comes FIRST from the blog SAMPLES (the brand's real published prose), and
only falls back to marketing copy if no samples exist. Marketing copy lies about
voice; the blog is how they actually write. Derive we_are / we_are_not as
contrast pairs (e.g. we_are "blunt about trade-offs", we_are_not "hype-y").

CRITICAL OUTPUT RULES:
- Output ONE raw JSON object. Nothing else.
- No markdown. No backticks. No code fences.
- All string values must be plain text — never embed code blocks.`,
    user: `Read the crawled pages and blog samples below from ${hostname}.

Return JSON:
{
  "business": {
    "name": "...",
    "industry": "...",
    "description": "2-3 sentence summary of what this business actually does",
    "products_services": ["product/service 1", "..."],
    "target_audience": "who they sell to",
    "value_props": ["distinctive value 1", "..."],
    "geography": "global | US | Korea | etc."
  },
  "voice": {
    "persona": "specific archetype of the writer",
    "tone": "...",
    "register": "...",
    "vocabulary": ["distinctive word actually used", "..."],
    "we_are": ["concrete voice trait observed in the samples", "..."],
    "we_are_not": ["the misread to avoid for each trait", "..."],
    "signature_moves": ["recurring habit, e.g. 'opens on a specific failure'", "..."],
    "avoid": ["word/phrase this brand clearly never uses", "..."]
  }
}

BLOG SAMPLES (source of truth for voice — imitate THIS, not the marketing copy):
${samplesBlock}

CRAWLED PAGES (source for business facts):
${corpus}`,
  });

  let parsed: any;
  try {
    parsed = extractJson(text);
  } catch {
    return blankProfile(hostname, crawledUrls, hasBlog, hasPricing, branding, design);
  }

  try {
    return {
      business: {
        name: parsed.business?.name ?? hostname,
        industry: parsed.business?.industry ?? 'unknown',
        description: parsed.business?.description ?? '',
        products_services: parsed.business?.products_services ?? [],
        target_audience: parsed.business?.target_audience ?? 'unknown',
        value_props: parsed.business?.value_props ?? [],
        geography: parsed.business?.geography ?? 'unknown',
      },
      voice: {
        persona: parsed.voice?.persona ?? `Owner of ${hostname}`,
        tone: parsed.voice?.tone ?? 'clear, practical, confident',
        register: parsed.voice?.register ?? 'professional-conversational',
        vocabulary: parsed.voice?.vocabulary ?? [],
        we_are: parsed.voice?.we_are ?? [],
        we_are_not: parsed.voice?.we_are_not ?? [],
        signature_moves: parsed.voice?.signature_moves ?? [],
        avoid: parsed.voice?.avoid ?? [],
        samples: blogSamples,
      },
      branding,
      design,
      meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawledUrls },
    };
  } catch {
    return blankProfile(hostname, crawledUrls, hasBlog, hasPricing, branding, design);
  }
}

/**
 * A profile with nothing filled in but the hostname.
 *
 * Also the answer when there is no crawl to work from at all: the strategist can
 * still plan from the owner's own interview answers, and a plan built on their
 * stated intent beats making them wait a month for one.
 */
export function blankProfile(hostname: string, crawled: string[] = [], hasBlog = false, hasPricing = false, branding: BrandColors | null = null, design: SiteDesign | null = null): SiteProfile {
  return {
    business: {
      name: hostname, industry: 'unknown', description: '',
      products_services: [], target_audience: 'unknown', value_props: [], geography: 'unknown',
    },
    voice: {
      persona: `Owner of ${hostname}`, tone: 'clear, practical, confident',
      register: 'professional-conversational', vocabulary: [],
      we_are: [], we_are_not: [], signature_moves: [], avoid: [], samples: [],
    },
    branding,
    design,
    meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawled },
  };
}
