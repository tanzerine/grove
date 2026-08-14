/**
 * The MCP methods, wired to grove's data.
 *
 * `lib/mcp/protocol.ts` owns the envelope and `app/api/mcp` owns HTTP and
 * authentication; by the time anything here runs, the caller's key has already
 * resolved to exactly one domain row. Every query in this file is scoped to
 * that row — there is no code path that takes a domain id from the caller,
 * which is what makes a leaked key a problem for one blog and not for the
 * platform.
 *
 * The page-building helpers (extractToc, pickRelated, buildArticleGraph,
 * buildHtmlField…) are the same ones the hosted article page and the embed API
 * call. Three surfaces, one set of builders: an article rendered through MCP on
 * a customer's own site gets the same table of contents, the same structured
 * data and the same call-to-action as the copy grove hosts.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripLeadingH1, stripLeadingCoverImage } from '@/lib/article-body';
import { extractToc } from '@/lib/markdown';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { pickRelated } from '@/lib/related-posts';
import { extractFaq } from '@/lib/faq';
import { buildArticleGraph, canonicalBaseFor, normalizeCanonicalBase, normalizeBlogHostname, appBase } from '@/lib/seo';
import { embedSeoStatus, crawlableArticleUrl } from '@/lib/embed-seo';
import { embedTheme, brandingPayload, resolveBranding } from '@/lib/blog-theme';
import { buildHtmlField } from '@/lib/blog/article-html';
import { buildTrackerScript } from '@/lib/analytics/beacon';
import { RpcError, RPC, negotiateProtocol, type Handlers } from './protocol';
import {
  TOOLS, TOOLS_BY_NAME, toolWire, parseToolArgs,
  PROMPTS, PROMPTS_BY_NAME,
  SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS,
  INDEX_URI, articleUri, slugFromUri, RESOURCE_TEMPLATES,
} from './tools';
import {
  articleChecksum, toContentFile, suggestedPath, readMinutes, wordCount,
  articleFrontmatter, type McpArticle, type ArticleFormat,
} from './format';
import { planSync, type RemoteArticle } from './sync';

/** The domain row the key resolved to. Loosely typed like every other holder
 *  of a `select('*')` row in this codebase. */
export type McpDomain = {
  id: string;
  hostname: string;
  blog_slug?: string | null;
  canonical_blog_base?: string | null;
  custom_blog_hostname?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

/**
 * Every column an article file is built from. `body_md` is in the list on
 * purpose even for the LIST call, where the embed API deliberately omits it:
 * the checksum hashes the body (see lib/mcp/format), so a list that skipped it
 * could only report timestamps — and timestamps miss every edit that isn't a
 * full refresh. The body is read on grove's side and never crosses the wire;
 * the customer receives 16 characters per article.
 */
const ARTICLE_COLUMNS =
  'id,slug,title,body_md,meta_title,meta_description,published_at,updated_at,cover_image_url,cover_image_credit,format:research->brief->>format';

/** How many articles plan_sync will consider before it stops claiming the
 *  remote list is complete. Above this, orphan detection is suppressed. */
const SYNC_CAP = 500;

/* ───────────────────────── result helpers ───────────────────────── */

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return structured ? { content: [{ type: 'text', text }], structuredContent: structured } : { content: [{ type: 'text', text }] };
}

/**
 * A failure the MODEL should handle, not the client — a slug that doesn't
 * exist, a base URL on the wrong domain. MCP wants these as a result with
 * isError, not a JSON-RPC error, so the model reads the reason and corrects
 * itself instead of the client surfacing a transport failure.
 */
function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/* ───────────────────────── shared shaping ───────────────────────── */

type PostRow = {
  id: string;
  slug: string;
  title: string | null;
  body_md: string | null;
  meta_title: string | null;
  meta_description: string | null;
  published_at: string | null;
  updated_at: string | null;
  cover_image_url: string | null;
  cover_image_credit: string | null;
  format?: string | null;
};

/**
 * Post row → the article a customer's layer receives.
 *
 * The leading `# Title` and the leading cover image come off here, for the same
 * reason the embed API strips them: the title is a frontmatter field and the
 * cover is an image field, so leaving them in the body renders each twice. The
 * checksum therefore hashes exactly the text that lands in the file.
 */
function toArticle(domain: McpDomain, post: PostRow): McpArticle {
  const body = stripLeadingCoverImage(stripLeadingH1(post.body_md ?? ''), post.cover_image_url);
  return {
    slug: post.slug,
    title: post.title ?? '',
    body_md: body,
    meta_title: post.meta_title,
    meta_description: post.meta_description,
    published_at: post.published_at,
    updated_at: post.updated_at,
    cover_image_url: post.cover_image_url,
    cover_image_credit: post.cover_image_credit,
    author: authorFor(domain.site_profile, domain.hostname),
    genre: genreFor(post.format ?? null, post.title ?? '').label,
    canonical_url: crawlableArticleUrl(domain, post.slug),
    post_id: post.id,
    domain_id: domain.id,
  };
}

/** The card-level summary of an article — what list_articles returns. */
function articleSummary(article: McpArticle) {
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.meta_description,
    published_at: article.published_at,
    updated_at: article.updated_at,
    genre: article.genre,
    author: article.author,
    cover_image_url: article.cover_image_url,
    cover_image_credit: article.cover_image_credit,
    canonical_url: article.canonical_url,
    read_minutes: readMinutes(article.body_md),
    word_count: wordCount(article.body_md),
    checksum: articleChecksum(article),
    suggested_path: suggestedPath(article.slug, 'mdx'),
  };
}

function businessNameFor(domain: McpDomain): string {
  return domain.site_profile?.business?.name || domain.hostname.replace(/^www\./, '');
}

function homeUrlFor(domain: McpDomain): string {
  return `https://${String(domain.hostname).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
}

function ctaFor(domain: McpDomain) {
  const business = domain.site_profile?.business ?? null;
  return {
    headline: `Try ${businessNameFor(domain)}`,
    subline: business?.value_props?.[0] || business?.description || '',
    url: domain.cta_url || homeUrlFor(domain),
  };
}

/** A published-articles query scoped to this domain, with the same
 *  unlinkable-post guard the embed list uses (a slug-less post has nowhere to
 *  point, so it must never reach a customer's content directory). */
function publishedQuery(sb: ReturnType<typeof supabaseAdmin>, domain: McpDomain, columns: string, opts: { count?: boolean } = {}) {
  return sb
    .from('posts')
    .select(columns, opts.count ? { count: 'exact' } : undefined)
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .not('slug', 'is', null)
    .neq('slug', '');
}

/* ────────────────────────────── tools ────────────────────────────── */

async function describeBlog(domain: McpDomain): Promise<ToolResult> {
  const sb = supabaseAdmin();
  const [{ count }, { data: recent }] = await Promise.all([
    publishedQuery(sb, domain, 'id', { count: true }).limit(1),
    publishedQuery(sb, domain, 'slug,title,published_at,format:research->brief->>format')
      .order('published_at', { ascending: false })
      .limit(200),
  ]);

  const rows = (recent ?? []) as unknown as { slug: string; title: string | null; published_at: string | null; format?: string | null }[];
  const genres: Record<string, number> = {};
  for (const r of rows) {
    const label = genreFor(r.format ?? null, r.title ?? '').label;
    genres[label] = (genres[label] ?? 0) + 1;
  }

  const seo = embedSeoStatus(domain, appBase());
  const branding = resolveBranding(domain);
  const published = count ?? rows.length;

  const next_steps: string[] = [];
  if (published === 0) {
    next_steps.push('Nothing is published yet. Grove publishes on a schedule — build the integration now and the first sync will pick articles up.');
  }
  if (seo.state === 'hash-only') {
    next_steps.push('No article base is set, so grove\'s hosted mirror is still canonical. Render the articles on this site, then call set_article_base with the URL prefix they are served at.');
  } else if (seo.state === 'self-served') {
    next_steps.push(`Articles are canonical at ${seo.articleBase}/<slug>. Keep serving that path, or call set_article_base if it moves.`);
  } else if (seo.state === 'subdomain') {
    next_steps.push(`Grove currently serves the whole blog at ${seo.articleBase}. If you render articles in this codebase instead, call set_article_base with your own path — it takes precedence.`);
  }
  next_steps.push('Install the analytics beacon from integration_kit on the article template — reads feed the strategy that decides what grove writes next.');

  const payload = {
    domain: domain.hostname,
    business_name: businessNameFor(domain),
    author: authorFor(domain.site_profile, domain.hostname),
    home_url: homeUrlFor(domain),
    published_articles: published,
    latest_published_at: rows[0]?.published_at ?? null,
    genres,
    branding: brandingPayload(branding),
    call_to_action: ctaFor(domain),
    canonical: {
      state: seo.state,
      crawlable: seo.crawlable,
      article_base: seo.articleBase,
      detail: seo.detail,
      grove_mirror: domain.blog_slug ? `${appBase()}/b/${domain.blog_slug}` : null,
    },
    next_steps,
  };

  const text = [
    `${domain.hostname} — ${published} published article${published === 1 ? '' : 's'}, written as ${payload.author}.`,
    `Canonical: ${seo.detail}`,
    '',
    'Next:',
    ...next_steps.map((s) => `- ${s}`),
  ].join('\n');

  return ok(text, payload);
}

async function listArticles(domain: McpDomain, args: { since?: string; q?: string; limit?: number; offset?: number }): Promise<ToolResult> {
  const limit = args.limit ?? 25;
  const offset = args.offset ?? 0;
  const sb = supabaseAdmin();

  let query = publishedQuery(sb, domain, ARTICLE_COLUMNS, { count: true });

  if (args.since) {
    const t = Date.parse(args.since);
    if (!Number.isFinite(t)) {
      return fail(`\`since\` must be a date grove can parse (e.g. 2026-08-01 or 2026-08-01T00:00:00Z); got "${args.since}".`);
    }
    // Re-serialized from the parsed timestamp, never interpolated raw: this
    // value goes into a PostgREST .or() filter, where a comma would inject
    // extra conditions.
    const iso = new Date(t).toISOString();
    query = query.or(`published_at.gte.${iso},updated_at.gte.${iso}`);
  }

  if (args.q) {
    // Commas and parens are filter syntax to PostgREST; strip rather than
    // reject so a title search with punctuation still does something sensible.
    const needle = args.q.replace(/[,()*%]/g, ' ').trim();
    if (needle) query = query.ilike('title', `%${needle}%`);
  }

  const { data, count, error } = await query
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new RpcError(RPC.INTERNAL_ERROR, 'could not read articles');

  const articles = ((data ?? []) as unknown as PostRow[]).map((p) => articleSummary(toArticle(domain, p)));
  const total = count ?? articles.length;
  const has_more = offset + articles.length < total;

  const payload = { total, offset, count: articles.length, has_more, articles };
  const text = articles.length === 0
    ? 'No published articles match.'
    : [
        `${articles.length} of ${total} published article${total === 1 ? '' : 's'}${has_more ? ` (more at offset ${offset + articles.length})` : ''}:`,
        ...articles.map((a) => `- ${a.slug} — ${a.title} [${a.genre}, ${a.read_minutes} min, checksum ${a.checksum}]`),
      ].join('\n');

  return ok(text, payload);
}

async function getArticle(domain: McpDomain, args: { slug: string; format?: ArticleFormat }): Promise<ToolResult> {
  const format: ArticleFormat = args.format ?? 'mdx';
  const sb = supabaseAdmin();
  const { data } = await publishedQuery(sb, domain, ARTICLE_COLUMNS).eq('slug', args.slug).maybeSingle();

  if (!data) {
    return fail(`No published article with slug "${args.slug}" on ${domain.hostname}. Call list_articles for the current slugs — a draft or a scheduled post is not readable here until it publishes.`);
  }

  const article = toArticle(domain, data as unknown as PostRow);
  const checksum = articleChecksum(article);

  if (format === 'md' || format === 'mdx') {
    const path = suggestedPath(article.slug, format);
    return ok(toContentFile(article, format), {
      slug: article.slug,
      format,
      checksum,
      suggested_path: path,
      frontmatter: articleFrontmatter(article),
    });
  }

  const toc = extractToc(article.body_md);
  const theme = embedTheme(resolveBranding(domain));
  const cta = ctaFor(domain);
  const businessName = businessNameFor(domain);

  if (format === 'html') {
    return ok(buildHtmlField(article.body_md, toc, cta, businessName, theme), {
      slug: article.slug, format, checksum, canonical_url: article.canonical_url,
    });
  }

  // json — the parts, for a layer that composes its own page.
  const { data: siblings } = await publishedQuery(sb, domain, 'slug,title,meta_description,cover_image_url,published_at')
    .neq('slug', article.slug)
    .order('published_at', { ascending: false })
    .limit(24);

  const author = article.author;
  const payload = {
    ...articleSummary(article),
    checksum,
    body_md: article.body_md,
    meta_title: article.meta_title,
    toc,
    related: pickRelated({ slug: article.slug, title: article.title }, (siblings ?? []) as any[], 3),
    call_to_action: cta,
    branding: brandingPayload(resolveBranding(domain)),
    // Same @graph the hosted page emits — render it in a
    // <script type="application/ld+json"> on your article page.
    json_ld: buildArticleGraph({
      hostname: domain.hostname,
      blogSlug: domain.blog_slug ?? '',
      postSlug: article.slug,
      title: article.title,
      description: article.meta_description,
      image: article.cover_image_url,
      publishedAt: article.published_at,
      updatedAt: article.updated_at,
      businessName,
      homeUrl: homeUrlFor(domain),
      authorName: author,
      authorIsOrg: author.endsWith('Team'),
      genreLabel: article.genre,
      wordCount: wordCount(article.body_md),
      faqs: extractFaq(article.body_md),
      canonicalBase: canonicalBaseFor(domain),
    }),
    // For the analytics beacon on your page — see integration_kit.
    post_id: article.post_id,
    domain_id: article.domain_id,
  };

  return ok(JSON.stringify(payload, null, 2), payload);
}

async function planSyncTool(domain: McpDomain, args: { local: { slug: string; checksum?: string | null; path?: string | null }[] }): Promise<ToolResult> {
  const sb = supabaseAdmin();
  const { data, count } = await publishedQuery(sb, domain, ARTICLE_COLUMNS, { count: true })
    .order('published_at', { ascending: false })
    .range(0, SYNC_CAP - 1);

  const rows = (data ?? []) as unknown as PostRow[];
  const remote: RemoteArticle[] = rows.map((p) => {
    const a = toArticle(domain, p);
    return { slug: a.slug, checksum: articleChecksum(a), title: a.title, published_at: a.published_at };
  });

  const plan = planSync(remote, args.local ?? [], { remoteComplete: (count ?? rows.length) <= SYNC_CAP });

  const lines = [plan.summary];
  if (plan.create.length) {
    lines.push('', 'Add:', ...plan.create.map((i) => `- ${i.slug} — ${i.title ?? ''}`));
  }
  if (plan.update.length) {
    lines.push('', 'Rewrite:', ...plan.update.map((i) => `- ${i.slug}${i.path ? ` (${i.path})` : ''} — ${i.reason}`));
  }
  if (plan.orphaned.length) {
    lines.push('', 'No published article matches these local files (confirm before deleting anything):', ...plan.orphaned.map((i) => `- ${i.path ?? i.slug}`));
  }
  if (plan.create.length || plan.update.length) {
    lines.push('', 'Fetch each one with get_article in the format your content layer uses, and keep groveSlug/groveChecksum in the frontmatter you write.');
  }

  return ok(lines.join('\n'), plan as unknown as Record<string, unknown>);
}

async function integrationKit(domain: McpDomain, args: { framework?: string; slug?: string }): Promise<ToolResult> {
  const sb = supabaseAdmin();
  const base = appBase();
  const seo = embedSeoStatus(domain, base);

  let postId = '{POST_ID}';
  let exampleSlug: string | null = null;
  if (args.slug) {
    const { data } = await publishedQuery(sb, domain, 'id,slug').eq('slug', args.slug).maybeSingle();
    const row = data as unknown as { id: string; slug: string } | null;
    if (!row) {
      return fail(`No published article with slug "${args.slug}". Call integration_kit without a slug for a placeholder example, or list_articles for real slugs.`);
    }
    postId = row.id;
    exampleSlug = row.slug;
  }

  // Absolute endpoint: a page on the customer's own domain cannot resolve a
  // relative /api/track to grove.
  const beacon = buildTrackerScript({
    postId,
    domainId: domain.id,
    hostname: domain.hostname,
    endpoint: `${base}/api/track`,
  });

  const framework = args.framework ?? 'other';
  const beaconSnippet = wrapBeacon(framework, beacon);

  const payload = {
    analytics: {
      why: 'posts.reads is what the monthly strategy plans against. An article rendered on your site with no beacon is invisible to it.',
      endpoint: `${base}/api/track`,
      post_id: postId,
      domain_id: domain.id,
      example_slug: exampleSlug,
      snippet: beaconSnippet,
      note: 'post_id is per article — take it from get_article (format: "json"). domain_id is the same for every article on this blog.',
      conversion_hint: 'Add data-conv to any link you want counted as a conversion; outbound clicks and scroll depth are tracked automatically.',
    },
    canonical: {
      state: seo.state,
      article_base: seo.articleBase,
      tag: '<link rel="canonical" href="{canonical_url from get_article}" />',
      note: seo.state === 'hash-only'
        ? 'No article base is set yet, so canonical_url still points at grove\'s mirror. Render your pages first, then call set_article_base — every canonical_url flips to your URLs and you re-sync once.'
        : 'canonical_url from get_article already points at your own pages. Emit it as-is.',
    },
    structured_data: {
      note: 'get_article (format: "json") returns json_ld — the same Article @graph grove\'s own pages emit. Render it verbatim inside <script type="application/ld+json">.',
    },
    frontmatter_map: {
      note: 'Rename these to whatever your content loader already reads. Keep groveSlug and groveChecksum: plan_sync uses them to tell a current file from a stale one.',
      fields: {
        title: 'string', description: 'string — meta description, good excerpt for cards',
        date: 'ISO timestamp — first publication', updated: 'ISO timestamp or absent',
        slug: 'string', author: 'string — never "AI"', category: 'string — reader-facing genre',
        image: 'absolute URL or absent', imageCredit: 'string or absent',
        canonical: 'absolute URL', groveSlug: 'string — keep', groveChecksum: 'string — keep',
        grovePostId: 'uuid — keep if you want the beacon wired automatically',
      },
    },
    sitemap: domain.blog_slug
      ? {
          note: 'If you serve the articles yourself, add grove\'s sitemap to your robots.txt so Google accepts the cross-hosted URLs — or generate your own from list_articles.',
          line: `Sitemap: ${base}/b/${domain.blog_slug}/sitemap.xml`,
        }
      : null,
  };

  const text = [
    `Integration kit for ${domain.hostname}${exampleSlug ? ` (example: ${exampleSlug})` : ''}.`,
    '',
    '1. Analytics beacon — put this in your article template:',
    '',
    beaconSnippet,
    '',
    postId === '{POST_ID}'
      ? '   Replace {POST_ID} with the article\'s post_id from get_article (format: "json"); domain_id is already filled in.'
      : `   post_id is filled in for ${exampleSlug}. Every other article needs its own — take it from get_article (format: "json"), or store grovePostId in frontmatter and read it back.`,
    '',
    `2. Canonical — ${payload.canonical.note}`,
    '',
    '3. Structured data — render get_article\'s json_ld verbatim in <script type="application/ld+json">.',
    '',
    '4. Frontmatter — rename grove\'s fields to your loader\'s, but keep groveSlug and groveChecksum.',
  ].join('\n');

  return ok(text, payload);
}

/** The beacon in the idiom of the customer's framework. */
function wrapBeacon(framework: string, script: string): string {
  switch (framework) {
    case 'next':
    case 'remix':
      return `<script dangerouslySetInnerHTML={{ __html: \`${script.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\` }} />`;
    case 'astro':
      return `<script is:inline set:html={\`${script.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`} />`;
    case 'nuxt':
    case 'sveltekit':
    case 'hugo':
    default:
      return `<script>${script}</script>`;
  }
}

async function setArticleBase(domain: McpDomain, args: { base_url: string }): Promise<ToolResult> {
  const sb = supabaseAdmin();
  const raw = String(args.base_url ?? '').trim();

  if (raw === '') {
    const { error } = await sb.from('domains').update({ canonical_blog_base: null }).eq('id', domain.id);
    if (error) throw new RpcError(RPC.INTERNAL_ERROR, 'could not clear the article base');
    const after = embedSeoStatus({ ...domain, canonical_blog_base: null }, appBase());
    return ok(
      `Article base cleared. ${after.detail}`,
      { article_base: null, state: after.state, crawlable: after.crawlable },
    );
  }

  const normalized = normalizeCanonicalBase(raw);
  if (!normalized) {
    return fail(`"${raw}" is not a usable base URL. Give the prefix your articles are served at, without the slug — e.g. https://${domain.hostname.replace(/^www\./, '')}/blog.`);
  }

  if (!baseBelongsToDomain(domain, normalized)) {
    // A key can re-point its own blog; it cannot point grove's canonical URLs
    // at a host this domain has no claim to. The dashboard remains available
    // for the genuinely unusual case (a separate apex), where a human is
    // looking at what they're doing.
    return fail(
      `${normalized} is not on ${domain.hostname}. The article base must be that hostname or a subdomain of it — grove would otherwise point every canonical, sitemap entry and social link at a domain this blog doesn't own. Set it from the grove dashboard if the articles really do live on a different apex domain.`,
    );
  }

  const { error } = await sb.from('domains').update({ canonical_blog_base: normalized }).eq('id', domain.id);
  if (error) throw new RpcError(RPC.INTERNAL_ERROR, 'could not save the article base');

  const after = embedSeoStatus({ ...domain, canonical_blog_base: normalized }, appBase());
  const text = [
    `Article base set to ${normalized}.`,
    after.detail,
    '',
    // Every canonical_url changed, so every checksum changed with it (the
    // canonical is in the frontmatter). Saying so here is the difference
    // between one more sync and a customer discovering stale canonicals later.
    'Every article\'s canonical_url just changed, which changes its checksum — run plan_sync once more and rewrite what it lists, so the canonical in your frontmatter matches what grove now emits.',
    domain.blog_slug
      ? `Grove keeps serving ${appBase()}/b/${domain.blog_slug} as a non-canonical mirror. Add "Sitemap: ${appBase()}/b/${domain.blog_slug}/sitemap.xml" to your robots.txt so Google accepts the cross-hosted sitemap for your URLs.`
      : '',
  ].filter(Boolean).join('\n');

  return ok(text, { article_base: normalized, state: after.state, crawlable: after.crawlable });
}

/** Is this base URL on the domain the key belongs to (or a subdomain of it,
 *  or the hostname already CNAME'd at grove)? */
export function baseBelongsToDomain(domain: McpDomain, base: string): boolean {
  let host = '';
  try { host = new URL(base).hostname.toLowerCase(); } catch { return false; }
  const apex = String(domain.hostname ?? '').toLowerCase().replace(/^www\./, '');
  if (!apex) return false;
  if (host === apex || host.endsWith(`.${apex}`)) return true;
  const custom = normalizeBlogHostname(domain.custom_blog_hostname);
  return !!custom && host === custom;
}

/* ──────────────────────────── dispatch ──────────────────────────── */

const TOOL_IMPLS: Record<string, (domain: McpDomain, args: any) => Promise<ToolResult>> = {
  describe_blog: (d) => describeBlog(d),
  list_articles: listArticles,
  get_article: getArticle,
  plan_sync: planSyncTool,
  integration_kit: integrationKit,
  set_article_base: setArticleBase,
};

async function callTool(domain: McpDomain, params: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof params.name === 'string' ? params.name : '';
  const tool = TOOLS_BY_NAME[name];
  if (!tool) throw new RpcError(RPC.INVALID_PARAMS, `unknown tool: ${name || '(none)'}`);
  const args = parseToolArgs(tool, params.arguments ?? {});
  return TOOL_IMPLS[name](domain, args);
}

async function listResources(domain: McpDomain) {
  const sb = supabaseAdmin();
  const { data } = await publishedQuery(sb, domain, 'slug,title,meta_description')
    .order('published_at', { ascending: false })
    .limit(50);

  const rows = (data ?? []) as unknown as { slug: string; title: string | null; meta_description: string | null }[];
  return {
    resources: [
      {
        uri: INDEX_URI,
        name: `${domain.hostname} blog index`,
        title: `${domain.hostname} blog index`,
        description: 'Every published article with its checksum and canonical URL.',
        mimeType: 'application/json',
      },
      ...rows.map((r) => ({
        uri: articleUri(r.slug),
        name: r.title ?? r.slug,
        title: r.title ?? r.slug,
        description: r.meta_description ?? undefined,
        mimeType: 'text/markdown',
      })),
    ],
  };
}

async function readResource(domain: McpDomain, params: Record<string, unknown>) {
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const sb = supabaseAdmin();

  if (uri === INDEX_URI) {
    const { data } = await publishedQuery(sb, domain, ARTICLE_COLUMNS)
      .order('published_at', { ascending: false })
      .limit(200);
    const articles = ((data ?? []) as unknown as PostRow[]).map((p) => articleSummary(toArticle(domain, p)));
    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify({ domain: domain.hostname, articles }, null, 2),
      }],
    };
  }

  const slug = slugFromUri(uri);
  if (!slug) throw new RpcError(RPC.INVALID_PARAMS, `unknown resource: ${uri || '(none)'}`);

  const { data } = await publishedQuery(sb, domain, ARTICLE_COLUMNS).eq('slug', slug).maybeSingle();
  if (!data) throw new RpcError(RPC.INVALID_PARAMS, `no published article at ${uri}`);

  const article = toArticle(domain, data as unknown as PostRow);
  return {
    contents: [{ uri, mimeType: 'text/markdown', text: toContentFile(article, 'md') }],
  };
}

function getPrompt(params: Record<string, unknown>) {
  const name = typeof params.name === 'string' ? params.name : '';
  const prompt = PROMPTS_BY_NAME[name];
  if (!prompt) throw new RpcError(RPC.INVALID_PARAMS, `unknown prompt: ${name || '(none)'}`);
  const args = (params.arguments ?? {}) as Record<string, string>;
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args) } }],
  };
}

/**
 * Every method this server answers, bound to one authenticated domain.
 *
 * Stateless: `initialize` records nothing, so a client may hand its next call
 * to a different serverless instance and nothing notices.
 */
export function buildHandlers(domain: McpDomain): Handlers {
  return {
    initialize: (params) => ({
      protocolVersion: negotiateProtocol(params.protocolVersion),
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      serverInfo: { name: SERVER_NAME, title: 'Grove', version: SERVER_VERSION },
      instructions: SERVER_INSTRUCTIONS,
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS.map(toolWire) }),
    'tools/call': (params) => callTool(domain, params),
    'resources/list': () => listResources(domain),
    'resources/templates/list': () => ({ resourceTemplates: RESOURCE_TEMPLATES }),
    'resources/read': (params) => readResource(domain, params),
    'prompts/list': () => ({
      prompts: PROMPTS.map((p) => ({
        name: p.name, title: p.title, description: p.description, arguments: p.arguments,
      })),
    }),
    'prompts/get': (params) => getPrompt(params),
  };
}
