/**
 * Site profiler — crawls the customer's site once, extracts business details
 * AND brand voice, stores both as one rich JSON on the domain row.
 *
 * This is the context EVERY article writer call uses. Without it, the model
 * has no idea what the business does and produces generic, off-topic drafts.
 */
import { llmCall, extractJson } from '../llm';

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
  meta: {
    has_blog: boolean;
    has_pricing: boolean;
    pages_crawled: string[];
  };
};

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

  const [pagesResults, blogSamples] = await Promise.all([
    Promise.all(urls.map(fetchText)),
    discoverBlogSamples(hostname),
  ]);
  const pages = pagesResults.filter((p): p is NonNullable<typeof p> => !!p);

  // Always include the homepage even if empty
  if (!pages.length) {
    return emptyProfile(hostname);
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
    return emptyProfile(hostname, crawledUrls, hasBlog, hasPricing);
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
      meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawledUrls },
    };
  } catch {
    return emptyProfile(hostname, crawledUrls, hasBlog, hasPricing);
  }
}

function emptyProfile(hostname: string, crawled: string[] = [], hasBlog = false, hasPricing = false): SiteProfile {
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
    meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawled },
  };
}
