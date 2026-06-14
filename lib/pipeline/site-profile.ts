/**
 * Site profiler — crawls the customer's site once, extracts business details
 * AND brand voice, stores both as one rich JSON on the domain row.
 *
 * This is the context EVERY article writer call uses. Without it, the model
 * has no idea what the business does and produces generic, off-topic drafts.
 */
import { llmCall, extractJson } from '../llm';
import { isPublicHttpUrl } from '../net/ssrf';

export type BrandColors = {
  primary_color: string;
  btn_color: string;
  btn_text_color: string;
  banner_bg: string;
  banner_text: string;
  banner_text_muted: string;
  heading_font: string | null;
};

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
  meta: {
    has_blog: boolean;
    has_pricing: boolean;
    pages_crawled: string[];
  };
};

// ─── brand-color extraction helpers ─────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  }
  if (h.length === 6) {
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  return null;
}

function relativeLuminance(rgb: { r:number; g:number; b:number }): number {
  const lin = (c: number) => { const s=c/255; return s<=0.03928 ? s/12.92 : ((s+0.055)/1.055)**2.4; };
  return 0.2126*lin(rgb.r) + 0.7152*lin(rgb.g) + 0.0722*lin(rgb.b);
}

function isDark(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return !rgb || relativeLuminance(rgb) < 0.179;
}

function contrastColor(hex: string): string {
  return isDark(hex) ? '#ffffff' : '#1a2e1f';
}

function withOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})` : hex;
}

function hexToHsl(hex: string): { h:number; s:number; l:number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r=rgb.r/255, g=rgb.g/255, b=rgb.b/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0;
  const l=(max+min)/2;
  if (max!==min) {
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return { h:Math.round(h*360), s:Math.round(s*100), l:Math.round(l*100) };
}

function isInteresting(hex: string): boolean {
  const hsl = hexToHsl(hex);
  return !!hsl && hsl.l>=8 && hsl.l<=90 && hsl.s>=10;
}

function darkenHex(hex: string, amount=0.25): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const f=1-amount;
  const r=Math.round(rgb.r*f), g=Math.round(rgb.g*f), b=Math.round(rgb.b*f);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

const SYSTEM_FONTS = /^(arial|helvetica|times new roman|times|georgia|verdana|courier|courier new|trebuchet|impact|palatino|garamond|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|inherit|initial|unset)/i;

/** Extract brand colors and heading font from raw homepage HTML. */
export function extractBrandColors(html: string): BrandColors | null {
  try {
    // meta theme-color
    const themeColor = html.match(
      /<meta[^>]*name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i
    )?.[1]?.toLowerCase() ?? null;

    // all <style> block text
    const styleText = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map(m => m[1]).join('\n');

    // CSS custom properties with semantic brand names
    const brandVarColors: string[] = [];
    for (const m of styleText.matchAll(
      /--(primary|brand|accent|main|key|cta|action|button|hero|highlight|link)[-\w]*\s*:\s*(#[0-9a-fA-F]{3,6})/gi
    )) { brandVarColors.push(m[2].toLowerCase()); }

    // all hex colors in CSS (deduplicated, filtered to interesting ones)
    const allHex = [...styleText.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)]
      .map(m => `#${m[1].toLowerCase()}`);
    const interesting = [...new Set(allHex)].filter(isInteresting);
    const bySaturation = interesting
      .map(c => ({ c, hsl: hexToHsl(c)! }))
      .filter(x => x.hsl)
      .sort((a,b) => b.hsl.s - a.hsl.s);

    const primary = brandVarColors[0] ?? themeColor ?? bySaturation[0]?.c ?? null;
    if (!primary) return null;

    // pick button color: a different interesting color or fall back to primary
    const btnColor = brandVarColors.find(c => c!==primary)
      ?? bySaturation.find(x => x.c!==primary)?.c
      ?? primary;

    // banner background: use primary if dark, otherwise darken it
    const bannerBg = isDark(primary) ? primary : darkenHex(primary);
    const bannerText = contrastColor(bannerBg);

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

    return {
      primary_color: primary,
      btn_color: btnColor,
      btn_text_color: contrastColor(btnColor),
      banner_bg: bannerBg,
      banner_text: bannerText,
      banner_text_muted: withOpacity(bannerText, 0.65),
      heading_font: headingFont,
    };
  } catch { return null; }
}

/** Fetch homepage HTML (raw, before stripping) for brand-color extraction. */
async function fetchHomepageRaw(hostname: string): Promise<string | null> {
  for (const base of [`https://${hostname}`, `https://www.${hostname.replace(/^www\./,'')}`]) {
    try {
      if (!(await isPublicHttpUrl(base))) continue; // SSRF: owner-controlled host
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const r = await fetch(base, {
        signal: ctrl.signal, redirect: 'follow',
        headers: { 'user-agent': 'grove-profiler/1.0 (+https://grove.so)' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      if (!(r.headers.get('content-type')??'').includes('text/html')) continue;
      return await r.text();
    } catch { /* try next */ }
  }
  return null;
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
    if (!(await isPublicHttpUrl(url))) return null; // SSRF: owner-controlled host
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
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
      if (!(await isPublicHttpUrl(`${base}/blog`))) continue; // SSRF: owner-controlled host
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const r = await fetch(`${base}/blog`, {
        signal: ctrl.signal, redirect: 'follow',
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

  const [pagesResults, blogSamples, homepageHtml] = await Promise.all([
    Promise.all(urls.map(fetchText)),
    discoverBlogSamples(hostname),
    fetchHomepageRaw(hostname),
  ]);
  const pages = pagesResults.filter((p): p is NonNullable<typeof p> => !!p);
  const branding = homepageHtml ? extractBrandColors(homepageHtml) : null;

  // Always include the homepage even if empty
  if (!pages.length) {
    return emptyProfile(hostname, [], false, false, branding);
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
    return emptyProfile(hostname, crawledUrls, hasBlog, hasPricing, branding);
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
      meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawledUrls },
    };
  } catch {
    return emptyProfile(hostname, crawledUrls, hasBlog, hasPricing, branding);
  }
}

function emptyProfile(hostname: string, crawled: string[] = [], hasBlog = false, hasPricing = false, branding: BrandColors | null = null): SiteProfile {
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
    meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawled },
  };
}
