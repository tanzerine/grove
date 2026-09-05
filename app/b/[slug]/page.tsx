import { supabaseAdmin } from '@/lib/supabase/admin';
import { jsonLdScript, blogHomeUrl, blogPostUrl, subdomainSlugFromHost, isCustomBlogHost, canonicalBaseFor, servedBlogBaseFor, organizationNode } from '@/lib/seo';
import { sameAsFor } from '@/lib/org-identity';
import { genreFor, authorFor, authorIsOrg, type Genre } from '@/lib/blog-genre';
import { languageForDomain, type Language } from '@/lib/language';
import { archiveEntries } from '@/lib/blog-archive';
import { blogThemeVars, fallbackPalette, resolveBranding } from '@/lib/blog-theme';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

const PER_PAGE = 9;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  // select('*') on purpose: canonical_blog_base ships ahead of migration 0018
  // — naming a not-yet-applied column would error and 404 the whole blog.
  const { data: domain } = await sb.from('domains').select('*').eq('blog_slug', slug).single();
  // A customer-owned blog home (self-served base or CNAME'd hostname) is the
  // canonical when configured; this hosted index is then a mirror. The RSS
  // alternate stays on an origin grove serves.
  const url = blogHomeUrl(slug, canonicalBaseFor(domain));
  return {
    title: `${domain?.hostname ?? 'grove blog'} — articles`,
    description: `Posts by ${domain?.hostname}`,
    alternates: {
      canonical: url,
      types: { 'application/rss+xml': `${blogHomeUrl(slug, servedBlogBaseFor(domain))}/rss.xml` },
    },
    openGraph: {
      title: `${domain?.hostname ?? 'grove blog'} — articles`,
      description: `Posts by ${domain?.hostname}`,
      url,
      type: 'website',
      siteName: domain?.hostname,
    },
  };
}

type Row = {
  slug: string | null;
  title: string | null;
  meta_description: string | null;
  published_at: string | null;
  cover_image_url: string | null;
  reads: number | null;
  format: string | null;
};

export default async function BlogIndex({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; q?: string; tag?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const tag = (sp.tag ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const sb = supabaseAdmin();
  // select('*'): brand_override (0023) may ship ahead of the migration — naming
  // a not-yet-applied column would error and 404 the whole blog index.
  const { data: domain } = await sb
    .from('domains').select('*').eq('blog_slug', slug).single();
  if (!domain) notFound();

  const { data } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,cover_image_url,reads,format:research->brief->>format')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false });
  const all = (data ?? []) as unknown as Row[];

  const host = (await headers()).get('host');
  const onBlogHost = !!subdomainSlugFromHost(host) || isCustomBlogHost(host, domain);
  const prefix = onBlogHost ? '' : `/b/${slug}`;
  const lg = languageForDomain(domain);
  const t = lg.ui;
  const author = authorFor((domain as any).site_profile, domain.hostname, lg.code);

  // Customer palette (manual override wins over crawl): retints --moss (chips,
  // card hovers, featured badge, tags) and drives the coverless-card fallback
  // colors. Grove greens when absent.
  const branding = resolveBranding(domain);
  // The captured colors are passed so the accent is corrected against the page
  // it sits on (see blog-theme accentOn) and the banner is built from the
  // site's own surface. This inline style wins over the layout's :root inside
  // <main>, so it has to agree with it — pass the same thing the layout does.
  const themeStyle = blogThemeVars(branding, (domain as any)?.site_profile?.design?.colors) as React.CSSProperties | undefined;
  const covers = fallbackPalette(branding);

  // EVERY published article, as a real link, on every page of the index.
  //
  // The card grid paginates at 9, so before this the index exposed 10 anchors
  // and left the rest behind a `?page=N` chain that only advertised the next
  // page — while the JSON-LD below listed 20 URLs, which is metadata, not a
  // link. Measured on grove's own blog: 9 of 24 sitemap URLs came back
  // "Discovered – currently not indexed" from URL Inspection. Google had the
  // URLs and would not spend crawl budget on pages nothing linked to.
  // Unfiltered `all`, not `filtered`: a search or genre chip must not shrink
  // the archive, or the links vanish exactly when a crawler follows a chip.
  const archive = archiveEntries(all, {
    blogSlug: slug,
    canonicalBase: canonicalBaseFor(domain),
  });

  // genres present across the whole catalog → filter chips
  const genreById = new Map<string, Genre>();
  for (const p of all) {
    const g = genreFor(p.format, p.title, lg.code);
    if (!genreById.has(g.id)) genreById.set(g.id, g);
  }

  // featured = most-read article; pinned wide on the unfiltered first page
  const featured = !q && !tag && all.length >= 2
    ? all.reduce((best, p) => ((p.reads ?? 0) > (best.reads ?? 0) ? p : best), all[0])
    : null;

  const ql = q.toLowerCase();
  const filtered = all.filter((p) => {
    if (featured && p.slug === featured.slug) return false;
    if (tag && genreFor(p.format, p.title).id !== tag) return false;
    if (ql && !(`${p.title ?? ''} ${p.meta_description ?? ''}`.toLowerCase().includes(ql))) return false;
    return true;
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pages);
  const pageItems = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const mk = (over: { page?: number; q?: string; tag?: string }) => {
    const u = new URLSearchParams();
    const nq = over.q ?? q; const nt = over.tag ?? tag; const np = over.page ?? 1;
    if (nq) u.set('q', nq);
    if (nt) u.set('tag', nt);
    if (np > 1) u.set('page', String(np));
    const s = u.toString();
    return `${prefix || '/'}${s ? `?${s}` : ''}`;
  };

  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const businessName = (domain as any).site_profile?.business?.name || domain.hostname.replace(/^www\./, '');
  // JSON-LD must reference the canonical URLs, same as the <link rel=canonical>
  const ldBase = canonicalBaseFor(domain);
  const blogHome = blogHomeUrl(slug, ldBase);
  const orgId = `${homeUrl}#org`;
  const siteId = `${blogHome}#website`;
  const blogLd = {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode({ id: orgId, name: businessName, url: homeUrl, sameAs: sameAsFor((domain as any).site_profile) }),
      {
        '@type': 'WebSite',
        '@id': siteId,
        url: blogHome,
        name: `${domain.hostname} blog`,
        publisher: { '@id': orgId },
        inLanguage: 'en',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${blogHome}?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Blog',
        '@id': `${blogHome}#blog`,
        url: blogHome,
        name: `The ${domain.hostname} blog`,
        isPartOf: { '@id': siteId },
        inLanguage: 'en',
        blogPost: all.slice(0, 20).map((p) => ({
          '@type': 'BlogPosting',
          headline: p.title,
          url: blogPostUrl(slug, p.slug!, ldBase),
          datePublished: p.published_at ?? undefined,
          author: { '@type': authorIsOrg((domain as any).site_profile) ? 'Organization' : 'Person', name: author },
          inLanguage: lg.tag,
        })),
      },
    ],
  };

  return (
    <main className="wrap" lang={lg.tag} style={{ maxWidth: 1080, padding: 'clamp(28px, 6vw, 54px) clamp(16px, 3vw, 28px) 80px', ...themeStyle }}>
      {/* header: title left, search top-right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 6.5vw, 48px)', margin: 0, overflowWrap: 'anywhere' }}>{t.blogTitle(domain.hostname)}</h1>
          <p className="lede" style={{ marginTop: 8 }}>{t.tagline}</p>
        </div>
        <form method="GET" action={prefix || '/'} style={{ display: 'flex', gap: 8 }}>
          {tag && <input type="hidden" name="tag" value={tag} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={`${t.search}…`}
            aria-label={t.search}
            className="blog-search"
          />
          <button type="submit" className="btn btn-ghost btn-sm">{t.searchButton}</button>
        </form>
      </div>

      {/* genre filter chips */}
      {genreById.size > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 26, flexWrap: 'wrap' }}>
          <Chip href={mk({ tag: '', page: 1 })} active={!tag}>{t.allGenres}</Chip>
          {Array.from(genreById.values()).map((g) => (
            <Chip key={g.id} href={mk({ tag: g.id, page: 1 })} active={tag === g.id}>{g.label}</Chip>
          ))}
        </div>
      )}

      {/* featured — most-read, wide card */}
      {featured && current === 1 && (
        <Link href={`${prefix}/${featured.slug}`} className="feat-card">
          <div style={{ flex: '1 1 55%', padding: '32px 34px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', background: 'var(--moss)', color: 'white', borderRadius: 999, padding: '3px 10px' }}>{t.featured}</span>
              <GenreTag genre={genreFor(featured.format, featured.title, lg.code)} />
            </div>
            <h2 style={{ fontFamily: 'Inter', fontSize: 32, lineHeight: 1.12, margin: '14px 0 0' }}>{featured.title}</h2>
            {featured.meta_description && (
              <p style={{ color: 'var(--clay)', fontSize: 15, lineHeight: 1.6, margin: '10px 0 0' }}>{featured.meta_description}</p>
            )}
            <Byline author={author} date={featured.published_at} reads={featured.reads} lang={lg} />
          </div>
          {featured.cover_image_url
            ? <Image src={featured.cover_image_url} alt="" width={750} height={500} sizes="(max-width: 700px) 100vw, 45vw" priority className="feat-media" />
            : <div className="feat-fallback" aria-hidden style={{ background: fallbackColor(featured.title, covers) }}>{initialOf(featured.title)}</div>}
        </Link>
      )}

      {/* article grid — 9 per page */}
      {pageItems.length === 0 ? (
        <p style={{ marginTop: 40, color: 'var(--clay)' }}>
          {q || tag ? <>{t.noMatch}{q ? <> “{q}”</> : null}. <Link href={mk({ q: '', tag: '', page: 1 })} style={{ color: 'var(--moss)' }}>{t.clearFilters}</Link></> : t.noResults}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18, marginTop: 28 }}>
          {pageItems.map((p) => {
            const g = genreFor(p.format, p.title, lg.code);
            return (
              <Link key={p.slug} href={`${prefix}/${p.slug}`} className="bi-card">
                {p.cover_image_url
                  ? <Image src={p.cover_image_url} alt="" width={640} height={427} sizes="(max-width: 640px) 100vw, 340px" className="bi-cover" />
                  : <div className="bi-fallback" aria-hidden style={{ background: fallbackColor(p.title, covers) }}>{initialOf(p.title)}</div>}
                <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div><GenreTag genre={g} /></div>
                  <h2 style={{ fontFamily: 'Inter', fontSize: 20, lineHeight: 1.2, margin: '10px 0 0' }}>{p.title}</h2>
                  {p.meta_description && (
                    <p style={{ color: 'var(--clay)', fontSize: 13.5, lineHeight: 1.55, margin: '8px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.meta_description}
                    </p>
                  )}
                  <div style={{ marginTop: 'auto' }}>
                    <Byline author={author} date={p.published_at} lang={lg} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* pagination */}
      {pages > 1 && (
        <nav aria-label="Pages" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 44 }}>
          {current > 1
            ? <Link href={mk({ page: current - 1 })} className="pagenav-link">{t.newer}</Link>
            : <span className="pagenav-link off">{t.newer}</span>}
          <span className="mono" style={{ fontSize: 12, color: 'var(--clay)' }}>{t.pageOf(current, pages)}</span>
          {current < pages
            ? <Link href={mk({ page: current + 1 })} className="pagenav-link">{t.older}</Link>
            : <span className="pagenav-link off">{t.older}</span>}
        </nav>
      )}

      {/* The crawlable index. Quiet by design — it is a utility list, not a
          second feed — but it is server-rendered on every page, so each
          article is one hop from the blog home for readers and crawlers
          alike. */}
      {archive.length > 1 && (
        <nav
          aria-label={t.articleIndex}
          style={{ marginTop: 64, paddingTop: 28, borderTop: '1px solid var(--line)' }}
        >
          <h2
            className="mono"
            style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--clay)', margin: '0 0 16px' }}
          >
            {t.articleIndex}
          </h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              columns: '260px 3',
              columnGap: 32,
              fontSize: 13.5,
              lineHeight: 1.7,
            }}
          >
            {archive.map((a) => (
              <li key={a.slug} style={{ breakInside: 'avoid', marginBottom: 4 }}>
                <Link href={`${prefix}/${a.slug}`} className="archive-link">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(blogLd) }} />
    </main>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`chip-link${active ? ' on' : ''}`}>
      {children}
    </Link>
  );
}

/* Deterministic flat brand-family color + display initial for posts without
 * a cover, so coverless cards still look designed instead of bare. The palette
 * comes from the domain's extracted branding (lib/blog-theme fallbackPalette). */
function fallbackColor(title: string | null, palette: string[]): string {
  let h = 0;
  for (const ch of title ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
function initialOf(title: string | null): string {
  return Array.from((title ?? '').trim())[0]?.toUpperCase() ?? '·';
}

function GenreTag({ genre }: { genre: Genre }) {
  return (
    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--moss)', background: 'var(--accent-soft, rgba(89,148,94,0.10))', borderRadius: 999, padding: '3px 10px' }}>
      {genre.label}
    </span>
  );
}

function Byline(
  { author, date, reads, lang }:
  { author: string; date: string | null; reads?: number | null; lang: Language },
) {
  return (
    <p className="mono" style={{ fontSize: 11.5, color: 'var(--clay)', margin: '14px 0 0' }}>
      {lang.ui.by(author)}{date ? ` · ${new Date(date).toLocaleDateString(lang.locale)}` : ''}{reads && reads > 0 ? ` · ${lang.ui.reads(reads)}` : ''}
    </p>
  );
}
