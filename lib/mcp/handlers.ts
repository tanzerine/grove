/**
 * What each MCP tool actually does.
 *
 * Everything here runs with the service-role client, which bypasses RLS — so
 * every query MUST be scoped by hand to the domains the key resolves to. That
 * scoping happens in exactly one place (sitesFor / resolveSite) and every
 * handler goes through it; a query that reaches `posts` without a domain_id
 * from that resolution is a cross-tenant leak.
 */
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase, blogHomeUrl, blogPostUrl, canonicalBaseFor, normalizeCanonicalBase, buildArticleGraph } from '@/lib/seo';
import { crawlableArticleUrl } from '@/lib/embed-seo';
import { authorFor, genreFor, authorIsOrg } from '@/lib/blog-genre';
import { extractFaq } from '@/lib/faq';
import { orFilter, queryTokens, searchPosts, type SearchablePost } from '@/lib/post-search';
import { trafficSources, engagement, funnel, type EventRow } from '@/lib/analytics/aggregate';
import { pickRelated } from '@/lib/related-posts';
import { toolError, toolJson, toolText, type ToolResult } from './protocol';
import { formatPost, FORMATS, FRONTMATTER_STYLES, type ContentPost } from './format';
import { integrationGuide } from './guide';
import { hasScope } from './keys';
import { toolByName } from './tools';
import type { McpContext } from './auth';
import { languageForDomain, contentLength } from '../language';

const DOMAIN_COLUMNS =
  'id,hostname,blog_slug,canonical_blog_base,custom_blog_hostname,site_profile,cta_url,verified_at,language';

const POST_CARD_COLUMNS =
  'id,slug,title,topic,status,meta_description,published_at,updated_at,scheduled_at,created_at,cover_image_url,format:research->brief->>format';

const POST_FULL_COLUMNS =
  'id,slug,title,topic,status,body_md,meta_title,meta_description,published_at,updated_at,created_at,cover_image_url,cover_image_credit,format:research->brief->>format';

type Sb = ReturnType<typeof supabaseAdmin>;
type DomainRow = Record<string, any>;

// ── scoping ────────────────────────────────────────────────────────────────

/** Every site this key may read: the user's own, narrowed to the pinned one. */
async function sitesFor(sb: Sb, ctx: McpContext): Promise<DomainRow[]> {
  let q = sb.from('domains').select(DOMAIN_COLUMNS).eq('user_id', ctx.userId);
  if (ctx.domainId) q = q.eq('id', ctx.domainId);
  const { data } = await q.order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Which site a call is about. With one site the argument is optional; with
 * several it is required, and the error names them — an agent that guesses
 * would silently write one customer's articles into another's repo.
 */
async function resolveSite(sb: Sb, ctx: McpContext, arg: unknown): Promise<{ domain: DomainRow } | { error: string }> {
  const sites = await sitesFor(sb, ctx);
  if (!sites.length) return { error: 'This key has no sites. Connect a domain in the grove dashboard first.' };

  const wanted = String(arg ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!wanted) {
    if (sites.length === 1) return { domain: sites[0] };
    return {
      error: `This key can see ${sites.length} sites — pass "site" with one of: ${sites.map((s) => s.hostname).join(', ')}.`,
    };
  }

  const apex = wanted.replace(/^www\./, '');
  const match = sites.find(
    (s) => s.id === wanted || String(s.hostname).toLowerCase().replace(/^www\./, '') === apex,
  );
  if (!match) return { error: `No site "${arg}" on this key. Available: ${sites.map((s) => s.hostname).join(', ')}.` };
  return { domain: match };
}

// ── shared shapes ──────────────────────────────────────────────────────────

/** The article as the formatters and the JSON-LD builder need it. */
function contentPostFrom(post: any, domain: DomainRow): ContentPost {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title ?? '',
    body_md: post.body_md ?? '',
    meta_title: post.meta_title,
    meta_description: post.meta_description,
    published_at: post.published_at,
    updated_at: post.updated_at,
    cover_image_url: post.cover_image_url,
    cover_image_credit: post.cover_image_credit,
    author: authorFor(domain.site_profile, domain.hostname, languageForDomain(domain).code),
    genre: genreFor(post.format, post.title, languageForDomain(domain).code).label,
    // Where grove itself considers this article canonical: the customer's own
    // base once they have one, grove's mirror until then. Same answer the embed
    // gives, from the same helper — the imported file must not disagree with
    // the rel=canonical grove is emitting elsewhere for the same article.
    canonical_url: crawlableArticleUrl(domain as any, post.slug),
  };
}

/** Card-level metadata — no body, so a listing stays cheap. */
function cardFor(post: any, domain: DomainRow, delivered?: { external_url: string | null; delivered_at: string } | null) {
  return {
    grove_id: post.id,
    slug: post.slug,
    title: post.title,
    status: post.status,
    description: post.meta_description ?? null,
    genre: genreFor(post.format, post.title, languageForDomain(domain).code).label,
    published_at: post.published_at ?? null,
    updated_at: post.updated_at ?? null,
    cover: post.cover_image_url ?? null,
    grove_url: post.slug && domain.blog_slug ? blogPostUrl(domain.blog_slug, post.slug, canonicalBaseFor(domain as any)) : null,
    delivered: delivered ? { url: delivered.external_url, at: delivered.delivered_at } : null,
  };
}

/**
 * The Article @graph for the page head. Same builder and the same inputs the
 * embed's article endpoint uses (app/api/embed/host/[hostname]/article/[slug]) —
 * if you change the shape there, change it here, since a customer rendering
 * their own page emits whatever this returns.
 */
function jsonLdFor(post: any, domain: DomainRow) {
  const business = domain.site_profile?.business ?? null;
  const hostname = String(domain.hostname).replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Same language the hosted page and the embed use — a customer rendering
  // this @graph must not declare English over a Korean article.
  const lg = languageForDomain(domain);
  const author = authorFor(domain.site_profile, domain.hostname, lg.code);
  return buildArticleGraph({
    hostname: domain.hostname,
    blogSlug: domain.blog_slug ?? '',
    postSlug: post.slug,
    title: post.title ?? '',
    description: post.meta_description,
    image: post.cover_image_url,
    publishedAt: post.published_at,
    updatedAt: post.updated_at,
    businessName: business?.name || hostname,
    homeUrl: `https://${hostname}`,
    authorName: author,
    authorIsOrg: authorIsOrg(domain.site_profile),
    genreLabel: genreFor(post.format, post.title, lg.code).label,
    wordCount: contentLength(post.body_md ?? '', lg),
    inLanguage: lg.tag,
    faqs: extractFaq(post.body_md ?? ''),
    canonicalBase: canonicalBaseFor(domain as any),
  });
}

// ── argument schemas ───────────────────────────────────────────────────────

const formatArgs = {
  format: z.enum(FORMATS).optional(),
  frontmatter: z.enum(FRONTMATTER_STYLES).optional(),
  field_map: z.record(z.string().nullable()).nullish(),
};

const siteArg = { site: z.string().optional() };

const listPostsArgs = z.object({
  ...siteArg,
  status: z.enum(['published', 'review', 'scheduled', 'all']).optional(),
  query: z.string().optional(),
  since: z.string().optional(),
  delivered: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const getPostArgs = z.object({
  ...siteArg,
  ...formatArgs,
  slug: z.string().optional(),
  id: z.string().optional(),
  include_json_ld: z.boolean().optional(),
});

const pullNewArgs = z.object({ ...siteArg, ...formatArgs, limit: z.number().int().min(1).max(20).optional() });

const recordDeliveryArgs = z.object({
  ...siteArg,
  slug: z.string().optional(),
  id: z.string().optional(),
  url: z.string().optional(),
  external_id: z.string().optional(),
  layer: z.string().optional(),
});

const canonicalArgs = z.object({ ...siteArg, base: z.string() });

const analyticsArgs = z.object({ ...siteArg, slug: z.string().optional(), days: z.number().int().min(1).max(365).optional() });

// ── dispatch ───────────────────────────────────────────────────────────────

export async function callTool(name: string, rawArgs: unknown, ctx: McpContext): Promise<ToolResult> {
  const def = toolByName(name);
  if (!def) return toolError(`Unknown tool "${name}".`);
  if (def.scope === 'write' && !hasScope({ scopes: ctx.scopes }, 'write')) {
    return toolError(
      `"${name}" needs a key with write access; this one is read-only. Create a read + write key in the grove dashboard under Content API.`,
    );
  }

  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>;
  const sb = supabaseAdmin();

  switch (name) {
    case 'list_sites': return listSites(sb, ctx);
    case 'list_posts': return listPosts(sb, ctx, args);
    case 'get_post': return getPost(sb, ctx, args);
    case 'pull_new': return pullNew(sb, ctx, args);
    case 'record_delivery': return recordDelivery(sb, ctx, args);
    case 'set_canonical_base': return setCanonicalBase(sb, ctx, args);
    case 'post_analytics': return postAnalytics(sb, ctx, args);
    case 'integration_guide': return guide(sb, ctx, args);
    default: return toolError(`Tool "${name}" is listed but not implemented.`);
  }
}

// ── tools ──────────────────────────────────────────────────────────────────

/**
 * What this key can reach, said out loud.
 *
 * A key pinned to one site returns exactly one row from list_sites — which is
 * indistinguishable from an account that simply owns one site. That ambiguity
 * is expensive: an agent reports "you have one site" to someone who has three,
 * and the only surface that tells the truth is resolveSite's error, which you
 * have to trip on purpose to see. So the scope travels with the list.
 */
export type KeyScope = {
  covers: 'one site' | 'every site on this account';
  pinned_to: string | null;
  note: string | null;
};

export function keyScope(pinnedDomainId: string | null, pinnedHostname: string | null): KeyScope {
  if (!pinnedDomainId) return { covers: 'every site on this account', pinned_to: null, note: null };
  return {
    covers: 'one site',
    pinned_to: pinnedHostname,
    note: pinnedHostname
      ? `This key is pinned to ${pinnedHostname}. Every other site on this account is invisible through it — make an all-sites key in the grove dashboard if the agent should see them.`
      : 'This key is pinned to a site that is no longer on this account. Make a new key in the grove dashboard.',
  };
}

async function listSites(sb: Sb, ctx: McpContext): Promise<ToolResult> {
  const sites = await sitesFor(sb, ctx);
  // A pinned key with no rows is not an empty account — it is a key outliving
  // the site it was made for, and "connect a domain" would send the customer
  // to fix something that isn't broken.
  if (!sites.length) {
    return toolText(ctx.domainId
      ? 'This key is pinned to a site that is no longer on this account. Make a new key in the grove dashboard.'
      : 'No sites on this key yet. Connect a domain in the grove dashboard first.');
  }

  const rows = await Promise.all(sites.map(async (d) => {
    const [{ count: published }, { count: delivered }] = await Promise.all([
      sb.from('posts').select('id', { count: 'exact', head: true }).eq('domain_id', d.id).eq('status', 'published').not('slug', 'is', null),
      sb.from('mcp_deliveries').select('id', { count: 'exact', head: true }).eq('domain_id', d.id),
    ]);
    const canonical = canonicalBaseFor(d as any);
    return {
      site: d.hostname,
      site_id: d.id,
      published: published ?? 0,
      delivered_to_your_layer: delivered ?? 0,
      awaiting_delivery: Math.max(0, (published ?? 0) - (delivered ?? 0)),
      // Where grove points rel=canonical today. Null means grove's own mirror
      // is still the canonical copy — set_canonical_base is what moves it.
      canonical_base: canonical,
      grove_mirror: d.blog_slug ? blogHomeUrl(d.blog_slug, null) : null,
      verified: !!d.verified_at,
    };
  }));

  // key_scope first: the model reads the answer to "is this everything?" before
  // it reads the list, not after.
  return toolJson({ key_scope: keyScope(ctx.domainId, sites[0]?.hostname ?? null), sites: rows });
}

async function listPosts(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = listPostsArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;

  const limit = a.limit ?? 25;
  const offset = a.offset ?? 0;
  const status = a.status ?? 'published';

  let q = sb.from('posts').select(POST_CARD_COLUMNS).eq('domain_id', domain.id);
  if (status !== 'all') q = q.eq('status', status);
  // A post with no slug has no URL on either side and cannot be imported.
  if (status === 'published') q = q.not('slug', 'is', null).neq('slug', '');
  if (a.since) {
    const since = new Date(a.since);
    if (Number.isNaN(since.getTime())) return toolError(`"since" is not a valid timestamp: ${a.since}`);
    q = q.or(`published_at.gte.${since.toISOString()},updated_at.gte.${since.toISOString()}`);
  }

  // Free-text search is a loose OR in SQL, ranked with AND semantics in JS —
  // the same two-stage shape the dashboard search bar uses (lib/post-search).
  const tokens = a.query ? queryTokens(a.query) : [];
  const or = tokens.length ? orFilter(tokens) : '';
  if (or) q = q.or(or);

  const { data, error } = await q
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return toolError(`Query failed: ${error.message}`);

  let posts = data ?? [];
  if (a.query && or) posts = searchPosts(posts as unknown as SearchablePost[], a.query) as unknown as typeof posts;

  const delivered = await deliveriesFor(sb, domain.id, posts.map((p: any) => p.id));
  let cards = posts.map((p: any) => cardFor(p, domain, delivered.get(p.id) ?? null));
  if (a.delivered === true) cards = cards.filter((c) => c.delivered);
  if (a.delivered === false) cards = cards.filter((c) => !c.delivered);

  return toolJson({
    site: domain.hostname,
    count: cards.length,
    // Bodies are deliberately absent. Use get_post for one article, or pull_new
    // for the ones not yet imported.
    posts: cards,
  });
}

async function getPost(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = getPostArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;
  if (!a.slug && !a.id) return toolError('Pass either "slug" or "id".');

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;

  let q = sb.from('posts').select(POST_FULL_COLUMNS).eq('domain_id', domain.id);
  q = a.id ? q.eq('id', a.id) : q.eq('slug', a.slug!);
  const { data: post } = await q.maybeSingle();
  if (!post) return toolError(`No article ${a.id ? `with id ${a.id}` : `at slug "${a.slug}"`} on ${domain.hostname}.`);
  if (!post.body_md) return toolError(`"${post.title ?? post.slug}" has no body yet (status: ${post.status}).`);

  const content = contentPostFrom(post, domain);
  const file = formatPost(content, { format: a.format, frontmatter: a.frontmatter, field_map: a.field_map ?? null });

  const { data: siblings } = await sb
    .from('posts')
    .select('slug,title,meta_description,cover_image_url,published_at')
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .neq('slug', post.slug)
    .order('published_at', { ascending: false })
    .limit(24);

  return toolJson({
    site: domain.hostname,
    article: {
      grove_id: post.id,
      slug: post.slug,
      title: post.title,
      status: post.status,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      author: content.author,
      genre: content.genre,
      published_at: post.published_at,
      updated_at: post.updated_at,
      cover_image_url: post.cover_image_url,
      cover_image_credit: post.cover_image_credit,
      canonical_url: content.canonical_url,
      // Keep these on the rendered page and pass them to the beacon, or grove's
      // reporting goes blind for this article (see integration_guide).
      analytics: { post_id: post.id, domain_id: domain.id, endpoint: `${appBase()}/api/track` },
      ...(a.include_json_ld === false ? {} : { json_ld: jsonLdFor(post, domain) }),
      related: pickRelated({ slug: post.slug, title: post.title ?? '' }, siblings ?? [], 3),
    },
    file: { filename: file.filename, format: file.format, media_type: file.media_type },
    content: file.content,
  });
}

async function pullNew(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = pullNewArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;
  const limit = a.limit ?? 5;

  const deliveredIds = await deliveredIdSet(sb, domain.id);

  // Oldest first. The ledger is walked forward: repeated calls march through the
  // backlog in publication order and never skip an article, which is what an
  // agent looping "pull, write, record" until empty needs. Newest-first would
  // re-order the customer's archive and make "am I done?" unanswerable.
  const picked: any[] = [];
  const CHUNK = 100;
  for (let offset = 0; picked.length < limit && offset < 1000; offset += CHUNK) {
    const { data } = await sb
      .from('posts')
      .select(POST_FULL_COLUMNS)
      .eq('domain_id', domain.id)
      .eq('status', 'published')
      .not('slug', 'is', null)
      .neq('slug', '')
      .order('published_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + CHUNK - 1);
    if (!data?.length) break;
    for (const p of data) {
      if (deliveredIds.has(p.id)) continue;
      picked.push(p);
      if (picked.length >= limit) break;
    }
    if (data.length < CHUNK) break;
  }

  const { count: publishedTotal } = await sb
    .from('posts').select('id', { count: 'exact', head: true })
    .eq('domain_id', domain.id).eq('status', 'published').not('slug', 'is', null);

  const remaining = Math.max(0, (publishedTotal ?? 0) - deliveredIds.size - picked.length);

  if (!picked.length) {
    return toolText(
      `Nothing new — all ${deliveredIds.size} published articles on ${domain.hostname} are already recorded as delivered.`,
      { site: domain.hostname, articles: [], remaining: 0 },
    );
  }

  const articles = picked.map((post) => {
    const content = contentPostFrom(post, domain);
    const file = formatPost(content, { format: a.format, frontmatter: a.frontmatter, field_map: a.field_map ?? null });
    return {
      grove_id: post.id,
      slug: post.slug,
      title: post.title,
      published_at: post.published_at,
      canonical_url: content.canonical_url,
      cover_image_url: post.cover_image_url,
      cover_image_credit: post.cover_image_credit,
      analytics: { post_id: post.id, domain_id: domain.id, endpoint: `${appBase()}/api/track` },
      filename: file.filename,
      media_type: file.media_type,
      content: file.content,
    };
  });

  return toolJson({
    site: domain.hostname,
    articles,
    remaining,
    next_step: 'Write each article into the existing content layer, then call record_delivery with its live URL. Until you do, the next pull_new returns these same articles.',
  });
}

async function recordDelivery(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = recordDeliveryArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;
  if (!a.slug && !a.id) return toolError('Pass either "slug" or "id" to say which article went live.');

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;

  let q = sb.from('posts').select('id,slug,title,status').eq('domain_id', domain.id);
  q = a.id ? q.eq('id', a.id) : q.eq('slug', a.slug!);
  const { data: post } = await q.maybeSingle();
  if (!post) return toolError(`No article ${a.id ? `with id ${a.id}` : `at slug "${a.slug}"`} on ${domain.hostname}.`);

  const url = a.url ? normalizeExternalUrl(a.url) : null;
  if (a.url && !url) return toolError(`"${a.url}" is not an absolute http(s) URL.`);

  // Upsert on post_id: re-delivering after an edit moves the record forward
  // rather than stacking duplicates, which is what makes the tool safe to
  // retry when a run is interrupted half way through a batch.
  const { error } = await sb.from('mcp_deliveries').upsert({
    domain_id: domain.id,
    post_id: post.id,
    key_id: ctx.keyId,
    external_url: url,
    external_id: a.external_id ?? null,
    layer: a.layer ?? null,
    delivered_at: new Date().toISOString(),
  }, { onConflict: 'post_id' });
  if (error) return toolError(`Could not record the delivery: ${error.message}`);

  const canonical = canonicalBaseFor(domain as any);
  const hint = canonical
    ? null
    : 'Grove still treats its own mirror as canonical for this site. Once the URL pattern is settled, call set_canonical_base so search credit goes to this domain instead.';

  return toolJson({
    recorded: { grove_id: post.id, slug: post.slug, url, layer: a.layer ?? null },
    ...(hint ? { hint } : {}),
  });
}

async function setCanonicalBase(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = canonicalArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;

  // The same normaliser the dashboard form uses, so a base set from an agent
  // and a base typed by hand cannot end up in two different shapes.
  const base = normalizeCanonicalBase(a.base);
  if (!base) return toolError(`"${a.base}" is not a usable base URL. Give an absolute https URL with no trailing slash, e.g. https://${String(domain.hostname).replace(/^www\./, '')}/blog.`);

  const { error } = await sb.from('domains').update({ canonical_blog_base: base }).eq('id', domain.id).eq('user_id', ctx.userId);
  if (error) return toolError(`Could not set the canonical base: ${error.message}`);

  return toolJson({
    site: domain.hostname,
    canonical_base: base,
    effect: `Every URL grove emits for ${domain.hostname} — rel=canonical, sitemap, RSS, JSON-LD, social posts and embed links — now points at ${base}/{slug}. Grove's copy stays up as a non-canonical mirror.`,
    check: `Make sure every published article actually resolves at ${base}/{slug} before relying on this — a canonical pointing at a 404 is worse than none.`,
  });
}

async function postAnalytics(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = analyticsArgs.safeParse(args);
  if (!parsed.success) return toolError(`Bad arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const a = parsed.data;

  const site = await resolveSite(sb, ctx, a.site);
  if ('error' in site) return toolError(site.error);
  const domain = site.domain;

  const days = a.days ?? 30;
  const from = new Date(Date.now() - days * 86400_000).toISOString();

  let postId: string | null = null;
  let postTitle: string | null = null;
  if (a.slug) {
    const { data: post } = await sb.from('posts').select('id,title').eq('domain_id', domain.id).eq('slug', a.slug).maybeSingle();
    if (!post) return toolError(`No article at slug "${a.slug}" on ${domain.hostname}.`);
    postId = post.id;
    postTitle = post.title;
  }

  let q = sb
    .from('post_events')
    .select('type,referrer_host,utm_source,scroll_depth,session_id,dwell_ms')
    .eq('domain_id', domain.id)
    .gte('created_at', from)
    .limit(10000);
  if (postId) q = q.eq('post_id', postId);
  const { data: events } = await q;

  const rows = (events ?? []) as EventRow[];
  const { total, sources } = trafficSources(rows);
  const eng = engagement(rows);
  const stages = funnel(rows);

  return toolJson({
    site: domain.hostname,
    scope: postId ? { slug: a.slug, title: postTitle } : 'all articles',
    window_days: days,
    // De-duplicated by session, not raw events: one engaged reader firing five
    // beacons is one reader. Same arithmetic the dashboard shows the customer,
    // from the same helpers (lib/analytics/aggregate).
    pageviews: total,
    readers: stages.clicks,
    read_past_half: stages.read50,
    cta_clicks: stages.converted,
    avg_seconds_on_page: Math.round(eng.avgDwellSec),
    traffic_sources: sources.map((s) => ({ source: s.name, pageviews: s.clicks, pct: s.pct })),
    note: rows.length
      ? null
      : 'No events in this window. If articles are live on your own layer, check that the analytics beacon from integration_guide is firing — grove sees nothing without it.',
  });
}

async function guide(sb: Sb, ctx: McpContext, args: Record<string, unknown>): Promise<ToolResult> {
  const sites = await sitesFor(sb, ctx);
  const one = sites.length === 1 ? sites[0] : null;
  return toolText(
    integrationGuide({
      stack: args.stack,
      appBase: appBase(),
      hostname: one?.hostname ?? null,
      canonicalBase: one ? canonicalBaseFor(one as any) : null,
    }),
  );
}

// ── small helpers ──────────────────────────────────────────────────────────

async function deliveredIdSet(sb: Sb, domainId: string): Promise<Set<string>> {
  const { data } = await sb.from('mcp_deliveries').select('post_id').eq('domain_id', domainId).limit(5000);
  return new Set((data ?? []).map((r: any) => r.post_id));
}

async function deliveriesFor(sb: Sb, domainId: string, postIds: string[]) {
  const map = new Map<string, { external_url: string | null; delivered_at: string }>();
  if (!postIds.length) return map;
  const { data } = await sb
    .from('mcp_deliveries')
    .select('post_id,external_url,delivered_at')
    .eq('domain_id', domainId)
    .in('post_id', postIds);
  for (const r of data ?? []) map.set((r as any).post_id, { external_url: (r as any).external_url, delivered_at: (r as any).delivered_at });
  return map;
}

/** Absolute http(s) only — a relative path is meaningless to grove. */
function normalizeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
