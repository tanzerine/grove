/**
 * Shared SEO helpers for the public blog surface (/b/*, rss, sitemap, robots).
 */

/** Absolute origin the hosted blogs live on, no trailing slash. */
export function appBase(): string {
  // Fallback must be the live, brandable production domain — grove.so's DNS is
  // dead and the vercel.app alias is a moving target, so falling back to either
  // turns every canonical/sitemap/RSS/OG URL into a 404 or a non-brand host.
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://trygroveai.com').replace(/\/$/, '');
}

/* ─────────────── one canonical home per blog ───────────────
 * Precedence, most-customer-owned first:
 *   1. domains.canonical_blog_base — the customer serves articles on their OWN
 *      domain (reverse proxy or server-rendered route consuming our API);
 *      search equity accrues to them and the grove-hosted copy is a mirror.
 *   2. domains.custom_blog_hostname — a customer-owned hostname CNAME'd at
 *      grove (blog.customer.com); GROVE serves everything there, so equity
 *      lands on the customer's domain with zero code on their site.
 *   3. GROVE_BLOG_ROOT_DOMAIN — {slug}.{root} subdomain (middleware rewrite).
 *   4. /b/{slug} on the app origin.
 * EVERY absolute blog URL — canonical, OG, JSON-LD, sitemap, RSS, robots,
 * social copy, webhooks — must come from these builders so the shapes can
 * never diverge again. Callers that have the domain row pass its
 * canonical_blog_base through; pure builders take it as an option. */

export function blogRootDomain(): string | null {
  const v = (process.env.GROVE_BLOG_ROOT_DOMAIN ?? '')
    .trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return v || null;
}

/** Validate + normalize a customer-supplied canonical base: force https URL
 *  shape, strip trailing slashes, reject garbage. Null = not usable. */
export function normalizeCanonicalBase(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** Absolute URL of a blog's home (no trailing slash). */
export function blogHomeUrl(blogSlug: string, canonicalBase?: string | null): string {
  const base = normalizeCanonicalBase(canonicalBase);
  if (base) return base;
  const root = blogRootDomain();
  return root ? `https://${blogSlug}.${root}` : `${appBase()}/b/${blogSlug}`;
}

/** Absolute URL of one article. */
export function blogPostUrl(blogSlug: string, postSlug: string, canonicalBase?: string | null): string {
  return `${blogHomeUrl(blogSlug, canonicalBase)}/${postSlug}`;
}

/**
 * If `host` is a blog subdomain under GROVE_BLOG_ROOT_DOMAIN, return its slug.
 * Null for the root/app/www hosts, foreign hosts, or when the env is unset.
 */
export function subdomainSlugFromHost(host: string | null | undefined): string | null {
  const root = blogRootDomain();
  if (!root || !host) return null;
  const h = host.toLowerCase().split(':')[0];
  if (h === root || h === `www.${root}` || !h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  return /^[a-z0-9-]+$/.test(sub) && sub !== 'www' ? sub : null;
}

/** Validate + normalize a customer-owned blog hostname: bare lowercase host,
 *  at least two labels, no scheme/path/port. Null = not usable. */
export function normalizeBlogHostname(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split(':')[0];
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

/**
 * The columns the canonical precedence reads. Exported so a caller holding a
 * domain row can declare that its row is a legal input to these builders —
 * intersect it into the row type (see lib/active-domain DomainRow) rather than
 * casting at the call site. Both are optional because a caller may have
 * select()ed a narrower set of columns; absent reads as "not configured".
 *
 * All-optional makes this a WEAK TYPE: TypeScript rejects an argument that
 * shares no declared property with it, even one carrying an `any` index
 * signature. That check is the point — it catches a row that never selected
 * these columns, which would silently resolve every URL to the /b/ fallback.
 * Satisfy it by declaring the columns, never by casting them away.
 */
export type CanonicalFields = { canonical_blog_base?: string | null; custom_blog_hostname?: string | null };

/**
 * The base every customer-facing absolute blog URL builds on — canonical, OG,
 * JSON-LD, sitemap <loc>, RSS items, llms.txt, social shares. Callers with a
 * domain row pass it here instead of reading canonical_blog_base directly, so
 * the two customer-owned modes (self-served base, CNAME'd hostname) can't
 * fall out of sync across surfaces.
 */
export function canonicalBaseFor(domain: CanonicalFields | null | undefined): string | null {
  if (!domain) return null;
  const base = normalizeCanonicalBase(domain.canonical_blog_base);
  if (base) return base;
  const host = normalizeBlogHostname(domain.custom_blog_hostname);
  return host ? `https://${host}` : null;
}

/**
 * Like canonicalBaseFor, but only bases GROVE ITSELF serves (the CNAME'd
 * hostname). For self-referential URLs that must resolve — robots.txt's
 * sitemap pointer, the RSS alternate link — because a customer-rendered
 * canonical_blog_base doesn't serve those files.
 */
export function servedBlogBaseFor(domain: CanonicalFields | null | undefined): string | null {
  const host = normalizeBlogHostname(domain?.custom_blog_hostname);
  return host ? `https://${host}` : null;
}

/** True when the request's Host header is this domain's CNAME'd blog hostname
 *  (page is being served on the customer's own origin → root-relative links). */
export function isCustomBlogHost(host: string | null | undefined, domain: CanonicalFields | null | undefined): boolean {
  const h = normalizeBlogHostname(host);
  const c = normalizeBlogHostname(domain?.custom_blog_hostname);
  return !!h && !!c && h === c;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!),
  );
}

// Crawlers, preview fetchers, and CLI clients. These render the page (and
// inflate `reads`) but are not readers — the strategy loop consumes `reads`,
// so bot hits would skew next month's plan toward whatever bots crawl most.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discordbot|slackbot|embedly|pinterest|linkedinbot|twitterbot|vkshare|w3c_validator|lighthouse|headlesschrome|python-requests|python-urllib|curl\/|wget\/|go-http-client|java\/|ahrefs|semrush|mj12|dotbot|petalbot|gptbot|claudebot|ccbot|bytespider|amazonbot|applebot|yandex|baiduspider|duckduckbot/i;

export function isBot(ua: string | null | undefined): boolean {
  return !!ua && BOT_RE.test(ua);
}

/**
 * Normalize a customer hostname arriving from a URL path segment (the
 * /api/embed/host/[hostname] routes). Returns null for anything that isn't a
 * plain hostname. Two failure modes this closes:
 *   - malformed percent-encoding made decodeURIComponent throw → a 500 on a
 *     public, CORS-open endpoint
 *   - the raw value was interpolated into a PostgREST .or() filter, where a
 *     comma injects extra filter conditions
 */
export function sanitizeEmbedHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw);
  try { s = decodeURIComponent(s); } catch { return null; }
  s = s.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split(':')[0]; // stray port
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s)) return null;
  return s;
}

/**
 * Serialize an object for an inline <script type="application/ld+json">.
 * Escapes `<` so post titles containing "</script>" can't break out of the tag.
 */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

/**
 * Build a blog's RSS 2.0 feed. Enriched over a bare title/description feed with
 * full article HTML (content:encoded), author (dc:creator), and category — what
 * feed readers and syndicators actually render. The route renders markdown →
 * HTML and resolves author/genre; this stays pure for easy testing.
 */
export function buildRssXml(opts: {
  hostname: string;
  blogSlug: string;
  canonicalBase?: string | null;
  /** BCP-47 tag for <language>. Defaults to 'en' — see lib/language.ts. */
  inLanguage?: string;
  items: {
    slug: string | null;
    title?: string | null;
    description?: string | null;
    publishedAt?: string | null;
    coverUrl?: string | null;
    contentHtml?: string | null;
    category?: string | null;
    author?: string | null;
  }[];
}): string {
  const { hostname, blogSlug, canonicalBase, items } = opts;
  const blogUrl = blogHomeUrl(blogSlug, canonicalBase);
  const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  // Unparseable timestamps must not serialize as "Invalid Date" — feed
  // validators reject the whole feed over one bad pubDate. Omit instead.
  const rfc822 = (iso: string): string | null => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toUTCString() : null;
  };

  const xmlItems = items.filter((i) => i.slug).map((i) => {
    const url = blogPostUrl(blogSlug, i.slug!, canonicalBase);
    const pubDate = i.publishedAt ? rfc822(i.publishedAt) : null;
    return [
      '<item>',
      `<title>${escapeXml(i.title ?? '')}</title>`,
      `<link>${escapeXml(url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
      i.author ? `<dc:creator>${escapeXml(i.author)}</dc:creator>` : '',
      i.category ? `<category>${escapeXml(i.category)}</category>` : '',
      i.description ? `<description>${escapeXml(i.description)}</description>` : '',
      pubDate ? `<pubDate>${pubDate}</pubDate>` : '',
      i.coverUrl ? `<enclosure url="${escapeXml(i.coverUrl)}" type="image/webp" length="0"/>` : '',
      i.contentHtml ? `<content:encoded>${cdata(i.contentHtml)}</content:encoded>` : '',
      '</item>',
    ].filter(Boolean).join('\n');
  }).join('\n');

  const newest = items.find((i) => i.publishedAt)?.publishedAt;
  const lastBuild = (newest ? rfc822(newest) : null) ?? new Date(0).toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${escapeXml(`The ${hostname} blog`)}</title>
<link>${escapeXml(blogUrl)}</link>
<atom:link href="${escapeXml(`${blogHomeUrl(blogSlug)}/rss.xml`)}" rel="self" type="application/rss+xml"/>
<description>${escapeXml(`Articles by ${hostname}`)}</description>
<language>${escapeXml(opts.inLanguage ?? 'en')}</language>
<lastBuildDate>${lastBuild}</lastBuildDate>
${xmlItems}
</channel>
</rss>`;
}

/**
 * Build a blog's sitemap.xml. Includes the Google image-sitemap extension so a
 * post's cover image is discoverable in Google Images — extra surface area for
 * free.
 *
 * lastmod is `updated_at ?? published_at`: an article rewritten in place keeps
 * its URL and its first-publication date, so published_at alone would tell a
 * crawler nothing changed and the refresh would go unnoticed. Posts that have
 * never been refreshed carry a null updated_at and behave exactly as before.
 */
export function buildSitemapXml(opts: {
  blogSlug: string;
  canonicalBase?: string | null;
  posts: { slug: string | null; published_at?: string | null; updated_at?: string | null; cover_image_url?: string | null }[];
}): string {
  const { blogSlug, canonicalBase, posts } = opts;
  const day = (iso?: string | null) => (iso ? `<lastmod>${iso.slice(0, 10)}</lastmod>` : '');
  const modified = (p: { published_at?: string | null; updated_at?: string | null }) =>
    p.updated_at ?? p.published_at ?? null;

  const urls = posts
    .filter((p) => p.slug)
    .map((p) => {
      const img = p.cover_image_url
        ? `<image:image><image:loc>${escapeXml(p.cover_image_url)}</image:loc></image:image>`
        : '';
      return `<url><loc>${escapeXml(blogPostUrl(blogSlug, p.slug!, canonicalBase))}</loc>${day(modified(p))}${img}</url>`;
    })
    .join('');

  // index lastmod = the most recently CHANGED post. Not simply the first row:
  // posts arrive newest-first by published_at, so a refreshed older article is
  // the freshest thing on the blog while sitting well down the list.
  const indexLastmod = day(
    posts.map(modified).filter(Boolean).sort().pop() ?? null,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>${escapeXml(blogHomeUrl(blogSlug, canonicalBase))}</loc>${indexLastmod}</url>${urls}
</urlset>`;
}

/**
 * Build the linked structured-data @graph for one article. One graph with @id
 * cross-references (Organization → WebSite → WebPage → Article, plus Breadcrumb
 * and FAQ) beats a pile of disconnected scripts: search + answer engines read
 * it as a single connected entity, which strengthens entity recognition — a
 * known signal for both rich results and AI-answer citations.
 */
export function buildArticleGraph(opts: {
  hostname: string;
  blogSlug: string;
  postSlug: string;
  title: string;
  description?: string | null;
  image?: string | null;
  publishedAt?: string | null;
  /** Last in-place rewrite, if any. Drives dateModified; datePublished always
   *  stays at first publication so the article doesn't look brand new. */
  updatedAt?: string | null;
  businessName: string;
  homeUrl: string;            // the customer's own site (publisher/author url)
  authorName: string;
  authorIsOrg: boolean;
  genreLabel: string;
  wordCount: number;
  faqs?: { question: string; answer: string }[];
  inLanguage?: string;
  canonicalBase?: string | null;
}): { '@context': string; '@graph': unknown[] } {
  const {
    hostname, blogSlug, postSlug, title, description, image, publishedAt, updatedAt,
    businessName, homeUrl, authorName, authorIsOrg, genreLabel, wordCount,
    faqs = [], inLanguage = 'en', canonicalBase,
  } = opts;

  const blogHome = blogHomeUrl(blogSlug, canonicalBase);
  const pageUrl = blogPostUrl(blogSlug, postSlug, canonicalBase);
  const orgId = `${homeUrl}#org`;
  const siteId = `${blogHome}#website`;
  const pageId = `${pageUrl}#webpage`;
  const articleId = `${pageUrl}#article`;
  const breadcrumbId = `${pageUrl}#breadcrumb`;
  const faqId = `${pageUrl}#faq`;
  const undef = undefined;

  const graph: unknown[] = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: businessName,
      url: homeUrl,
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      url: blogHome,
      name: `${hostname} blog`,
      publisher: { '@id': orgId },
      inLanguage,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${blogHome}?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'WebPage',
      '@id': pageId,
      url: pageUrl,
      name: title,
      isPartOf: { '@id': siteId },
      primaryImageOfPage: image ? { '@type': 'ImageObject', url: image } : undef,
      breadcrumb: { '@id': breadcrumbId },
      inLanguage,
    },
    {
      '@type': 'BlogPosting',
      '@id': articleId,
      isPartOf: { '@id': pageId },
      mainEntityOfPage: { '@id': pageId },
      headline: title,
      description: description ?? undef,
      image: image ?? undef,
      datePublished: publishedAt ?? undef,
      dateModified: updatedAt ?? publishedAt ?? undef,
      articleSection: genreLabel,
      wordCount: wordCount || undef,
      inLanguage,
      author: { '@type': authorIsOrg ? 'Organization' : 'Person', name: authorName, url: homeUrl },
      publisher: { '@id': orgId },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': breadcrumbId,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: hostname, item: blogHome },
        { '@type': 'ListItem', position: 2, name: title, item: pageUrl },
      ],
    },
  ];

  if (faqs.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      '@id': faqId,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Build an llms.txt (per llmstxt.org) for a blog — a plain markdown index that
 * tells AI assistants and answer engines (ChatGPT, Perplexity, Claude, AI
 * Overviews) what this blog covers and where every article lives. Served at
 * {blog}/llms.txt next to robots.txt and sitemap.xml; the modern complement to
 * a sitemap, aimed at LLM crawlers rather than search spiders.
 */
export function buildLlmsTxt(opts: {
  hostname: string;
  blogSlug: string;
  canonicalBase?: string | null;
  description?: string | null;
  posts: { slug: string | null; title: string | null; meta_description?: string | null }[];
}): string {
  const { hostname, blogSlug, canonicalBase, description, posts } = opts;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const summary = clean(description) || `Articles and guides from ${hostname}.`;

  const lines: string[] = [
    `# ${hostname}`,
    '',
    `> ${summary}`,
    '',
    'This file helps AI assistants and answer engines discover, read, and cite this blog. Every published article is listed below with its canonical URL.',
    '',
    '## Articles',
    '',
  ];
  for (const p of posts) {
    if (!p.slug || !p.title) continue;
    // titles are markdown link text — neutralize brackets so a stray ] can't
    // break the link syntax for a parser.
    const title = clean(p.title).replace(/[[\]]/g, '');
    const desc = clean(p.meta_description);
    lines.push(`- [${title}](${blogPostUrl(blogSlug, p.slug, canonicalBase)})${desc ? `: ${desc}` : ''}`);
  }
  lines.push('', '## Home', '', `- [${hostname} blog](${blogHomeUrl(blogSlug, canonicalBase)})`, '');
  return lines.join('\n');
}
