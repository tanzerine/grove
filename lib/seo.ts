/**
 * Shared SEO helpers for the public blog surface (/b/*, rss, sitemap, robots).
 */

/** Absolute origin the hosted blogs live on, no trailing slash. */
export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove.so').replace(/\/$/, '');
}

/* ─────────────── one canonical home per blog ───────────────
 * With GROVE_BLOG_ROOT_DOMAIN set, every blog lives on its own subdomain
 * ({slug}.{root}, served by the middleware host-rewrite). Without it, blogs
 * live under /b/{slug} on the app origin. EVERY absolute blog URL — canonical,
 * OG, JSON-LD, sitemap, RSS, robots, social copy, webhooks — must come from
 * these two builders so the shapes can never diverge again. */

export function blogRootDomain(): string | null {
  const v = (process.env.GROVE_BLOG_ROOT_DOMAIN ?? '')
    .trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return v || null;
}

/** Absolute URL of a blog's home (no trailing slash). */
export function blogHomeUrl(blogSlug: string): string {
  const root = blogRootDomain();
  return root ? `https://${blogSlug}.${root}` : `${appBase()}/b/${blogSlug}`;
}

/** Absolute URL of one article. */
export function blogPostUrl(blogSlug: string, postSlug: string): string {
  return `${blogHomeUrl(blogSlug)}/${postSlug}`;
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
 * Serialize an object for an inline <script type="application/ld+json">.
 * Escapes `<` so post titles containing "</script>" can't break out of the tag.
 */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
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
  description?: string | null;
  posts: { slug: string | null; title: string | null; meta_description?: string | null }[];
}): string {
  const { hostname, blogSlug, description, posts } = opts;
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
    lines.push(`- [${title}](${blogPostUrl(blogSlug, p.slug)})${desc ? `: ${desc}` : ''}`);
  }
  lines.push('', '## Home', '', `- [${hostname} blog](${blogHomeUrl(blogSlug)})`, '');
  return lines.join('\n');
}
