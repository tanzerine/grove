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

export async function profileSite(hostname: string): Promise<SiteProfile> {
  const base = `https://${hostname}`;
  const altBase = `https://www.${hostname.replace(/^www\./, '')}`;

  // try both apex and www, dedupe URLs
  const urls = Array.from(new Set([
    ...CANDIDATE_PATHS.map((p) => `${base}${p}`),
    ...CANDIDATE_PATHS.map((p) => `${altBase}${p}`),
  ]));

  const pagesResults = await Promise.all(urls.map(fetchText));
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

  const { text } = await llmCall({
    fast: true,
    json: true,
    maxTokens: 1500,
    system: `You analyze a website and extract structured business intelligence.
Be specific. "professional" is useless — "engineer-to-engineer, blunt about trade-offs" is useful.
If a field is genuinely unknown, write "unknown" — never invent.

CRITICAL OUTPUT RULES:
- Output ONE raw JSON object. Nothing else.
- No markdown. No backticks. No code fences.
- All string values must be plain text — never embed code blocks.`,
    user: `Read the crawled pages below from ${hostname}.

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
    "vocabulary": ["distinctive word", "..."]
  }
}

CRAWLED PAGES:
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
    },
    meta: { has_blog: hasBlog, has_pricing: hasPricing, pages_crawled: crawled },
  };
}
