import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { extractFaq } from '@/lib/faq';
import { jsonLdScript, blogHomeUrl, blogPostUrl, subdomainSlugFromHost, isCustomBlogHost, canonicalBaseFor, servedBlogBaseFor, buildArticleGraph } from '@/lib/seo';
import { pickRelated } from '@/lib/related-posts';
import { injectInternalLinks } from '@/lib/internal-links';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { blogThemeVars, resolveBranding } from '@/lib/blog-theme';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  // select('*') on purpose: canonical_blog_base ships ahead of migration 0018
  // — naming a not-yet-applied column would error and 404 the whole blog.
  const { data: domain } = await sb.from('domains').select('*').eq('blog_slug', slug).single();
  if (!domain) return {};
  const { data: p } = await sb
    .from('posts')
    .select('title,meta_title,meta_description,cover_image_url,published_at')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) return {};

  // When the customer owns a blog surface — a self-served article base or a
  // CNAME'd hostname we serve for them — THAT page is the canonical and this
  // hosted copy is a mirror; equity flows to them.
  const url = blogPostUrl(slug, post, canonicalBaseFor(domain as any));
  const title = p.meta_title || p.title || undefined;
  const description = p.meta_description ?? undefined;
  // Real cover wins; otherwise a branded card generated at {post}/og so every
  // share still gets a rich preview instead of a bare link. The /og route only
  // exists on the hosted origin, so never build it from the canonical base.
  const ogImage = p.cover_image_url || `${blogPostUrl(slug, post)}/og`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      // feed alternate must resolve on an origin GROVE serves (hosted or the
      // CNAME'd host) — a customer-rendered canonical base has no rss.xml.
      types: { 'application/rss+xml': `${blogHomeUrl(slug, servedBlogBaseFor(domain as any))}/rss.xml` },
    },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      siteName: domain.hostname,
      publishedTime: p.published_at ?? undefined,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0018 DB
  if (!domain) notFound();
  const { data: p } = await sb
    .from('posts').select('title,body_md,published_at,meta_description,id,cover_image_url,cover_image_credit,format:research->brief->>format')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) notFound();

  // NOTE: `reads` is NOT incremented here. A server render fires for bots and
  // Next.js RSC prefetches too, which used to inflate the metric several-fold.
  // The one honest writer of posts.reads is the client 'view' beacon, deduped
  // per session in lib/analytics/track.ts ingestEvent().

  // On a blog host (grove subdomain or the customer's CNAME'd hostname) the
  // middleware strips the /b/{slug} prefix, so relative links must be
  // root-relative there and prefixed on the app host.
  const host = (await headers()).get('host');
  const onBlogHost = !!subdomainSlugFromHost(host) || isCustomBlogHost(host, domain as any);
  const prefix = onBlogHost ? '' : `/b/${slug}`;

  // Siblings power both retention features: contextual in-body links and the
  // "Keep reading" block. Injection happens at render time so every existing
  // post gains links as the blog grows.
  const { data: siblings } = await sb
    .from('posts').select('slug,title,meta_description,cover_image_url,published_at')
    .eq('domain_id', domain.id).eq('status', 'published').neq('id', p.id)
    .order('published_at', { ascending: false }).limit(24);
  const related = pickRelated({ slug: post, title: p.title }, siblings ?? [], 3);

  const { body: linkedMd } = injectInternalLinks(p.body_md ?? '', siblings ?? [], prefix);
  const html = mdToHtml(linkedMd);
  const toc = extractToc(p.body_md ?? '');

  // CTA banner: "Try {business}" → the owner's chosen page (domains.cta_url,
  // e.g. a signup or pricing page), defaulting to their homepage. Counts as a
  // conversion either way.
  const profile = (domain as any).site_profile ?? null;
  const business = profile?.business ?? null;
  const businessName: string = business?.name || domain.hostname.replace(/^www\./, '');
  const subline: string = business?.value_props?.[0] || business?.description || '';
  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const ctaUrl: string = (domain as any).cta_url || homeUrl;

  // Brand palette (manual override wins over the crawled colors) — applied as
  // CSS custom properties on the page root, so the banner AND everything hanging
  // off --moss (TOC, genre tag, read-progress, card hovers) pick up the palette.
  const branding = resolveBranding(domain);
  const themeStyle = blogThemeVars(branding) as React.CSSProperties | undefined;

  // Canonical article URL — the customer's own surface when one is configured.
  // Share buttons and JSON-LD must spread THAT url, not the mirror's.
  const pageUrl = blogPostUrl(slug, post, canonicalBaseFor(domain as any));
  const credit = (p as any).cover_image_credit as { name?: string; profile_url?: string } | null;
  const author = authorFor(profile, domain.hostname);
  const genre = genreFor((p as any).format, p.title);
  const readMin = Math.max(1, Math.round((p.body_md ?? '').split(/\s+/).length / 225));
  const shareX = `https://twitter.com/intent/tweet?text=${encodeURIComponent(p.title ?? '')}&url=${encodeURIComponent(pageUrl)}`;
  const shareLi = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
  // One linked @graph (Organization → WebSite → WebPage → Article + Breadcrumb
  // + FAQ) instead of disconnected scripts — read as a single entity by search
  // and answer engines. FAQPage is included only when a real FAQ is present.
  const faqs = extractFaq(p.body_md ?? '');
  const graphLd = buildArticleGraph({
    hostname: domain.hostname,
    blogSlug: slug,
    postSlug: post,
    title: p.title ?? '',
    description: p.meta_description,
    image: p.cover_image_url,
    publishedAt: p.published_at,
    businessName,
    homeUrl,
    authorName: author,
    authorIsOrg: author.endsWith('Team'),
    genreLabel: genre.label,
    wordCount: (p.body_md ?? '').split(/\s+/).filter(Boolean).length,
    faqs,
    canonicalBase: canonicalBaseFor(domain as any),
  });

  return (
    <main className="post-shell" style={themeStyle}>
      <div id="rp" className="read-progress" aria-hidden />
      <a href={prefix || '/'} className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← {domain.hostname}</a>

      <div className="post-grid" style={{ marginTop: 18 }}>
        <div className="post-main">
          <h1 className="display" style={{ fontSize: 46 }}>{p.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--moss)', background: 'var(--accent-soft, rgba(89,148,94,0.10))', borderRadius: 999, padding: '3px 10px' }}>
              {genre.label}
            </span>
            <p className="mono" style={{ color: 'var(--clay)', fontSize: 12, margin: 0 }}>
              By {author} · {new Date(p.published_at!).toLocaleDateString()} · {readMin} min read
            </p>
          </div>

          {p.cover_image_url && (
            <figure style={{ margin: '26px 0 0' }}>
              <img
                src={p.cover_image_url}
                alt={p.title ?? ''}
                style={{ display: 'block', width: '100%', borderRadius: 14, border: '1px solid var(--line)' }}
              />
              {credit?.name && (
                <figcaption className="mono" style={{ fontSize: 11, color: 'var(--clay)', marginTop: 6 }}>
                  Image: {credit.profile_url
                    ? <a href={credit.profile_url} target="_blank" rel="noopener noreferrer">{credit.name}</a>
                    : credit.name}
                </figcaption>
              )}
            </figure>
          )}

          <article
            className="prose"
            style={{ marginTop: 30, padding: '44px 40px', background: 'white', border: '1px solid var(--line)', borderRadius: 18, boxShadow: 'var(--sh-md)', maxWidth: 'none' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {/* "Try {business}" banner — links where the owner points it, tracked as a conversion */}
          <aside className="cta-banner">
            <div className="cta-kicker">Powered by {businessName}</div>
            <h3>Try {businessName}</h3>
            {subline && <p>{subline}</p>}
            <a className="cta-btn" href={ctaUrl} target="_blank" rel="noopener noreferrer" data-conv>
              Visit {businessName} →
            </a>
          </aside>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 26, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)' }}>Share</span>
            <a className="share-btn" href={shareX} target="_blank" rel="noopener noreferrer">X / Twitter</a>
            <a className="share-btn" href={shareLi} target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <button className="share-btn" id="cpy" data-url={pageUrl} type="button">Copy link</button>
          </div>

          {related.length > 0 && (
            <section style={{ marginTop: 36 }} aria-label="Related articles">
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>
                Keep reading
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(related.length, 3)}, 1fr)`, gap: 12 }}>
                {related.map((rp) => (
                  <a key={rp.slug} href={`${prefix}/${rp.slug}`} className="bi-card">
                    {rp.cover_image_url && (
                      <img src={rp.cover_image_url} alt="" loading="lazy" className="bi-cover" style={{ height: 110 }} />
                    )}
                    <div style={{ padding: '12px 14px 14px' }}>
                      <div style={{ fontFamily: 'Clash Display', fontSize: 16, lineHeight: 1.3 }}>{rp.title}</div>
                      {rp.meta_description && (
                        <p style={{ fontSize: 12.5, color: 'var(--clay)', margin: '6px 0 0', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {rp.meta_description}
                        </p>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        {toc.length >= 2 && (
          <aside className="toc-rail" aria-label="Table of contents">
            <div className="toc-title">On this page</div>
            <ol>
              {toc.map((item, i) => (
                <li key={`${item.id}-${i}`} className={item.level === 3 ? 'lvl3' : undefined}>
                  <a href={`#${item.id}`}>{item.text}</a>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graphLd) }} />
      <script
        dangerouslySetInnerHTML={{
          __html: buildTrackerScript({ postId: p.id, domainId: domain.id, hostname: domain.hostname }),
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html:
            `(function(){var b=document.getElementById('rp');if(b){addEventListener('scroll',function(){var h=document.documentElement;var m=h.scrollHeight-h.clientHeight;b.style.width=(m>0?h.scrollTop/m*100:0)+'%';},{passive:true});}` +
            `var c=document.getElementById('cpy');if(c){c.addEventListener('click',function(){if(!navigator.clipboard)return;navigator.clipboard.writeText(c.getAttribute('data-url')).then(function(){var t=c.textContent;c.textContent='Copied ✓';setTimeout(function(){c.textContent=t;},1600);});});}})();`,
        }}
      />
    </main>
  );
}

/**
 * Inline first-party tracker — emits view / dwell / scroll / outbound / exit
 * events to /api/track. No external script, no cookies, no fingerprinting.
 * Session id is per-tab (sessionStorage), so refreshes count as new sessions
 * which keeps dwell math honest.
 */
function buildTrackerScript({ postId, domainId, hostname }: { postId: string; domainId: string; hostname: string }) {
  const endpoint = '/api/track';
  const host = hostname.replace(/^www\./, '');
  return `(function(){
try{
var s=sessionStorage.getItem('g_sid');
if(!s){s=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem('g_sid',s);}
var u=new URL(location.href);
var utm={utm_source:u.searchParams.get('utm_source')||undefined,utm_medium:u.searchParams.get('utm_medium')||undefined,utm_campaign:u.searchParams.get('utm_campaign')||undefined,query:u.searchParams.get('q')||undefined};
var post=function(extra){
  try{
    var body=JSON.stringify(Object.assign({post_id:${JSON.stringify(postId)},domain_id:${JSON.stringify(domainId)},session_id:s,referrer:document.referrer||undefined},utm,extra));
    if(navigator.sendBeacon){navigator.sendBeacon(${JSON.stringify(endpoint)},new Blob([body],{type:'application/json'}));}
    else{fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true}).catch(function(){});}
  }catch(e){}
};
post({type:'view'});
var start=Date.now(),dwell=0,active=true,sentDepths={};
document.addEventListener('visibilitychange',function(){active=document.visibilityState==='visible';start=Date.now();});
setInterval(function(){if(active){dwell+=15000;post({type:'dwell',dwell_ms:dwell});}},15000);
window.addEventListener('scroll',function(){
  var h=document.documentElement;var max=(h.scrollTop+h.clientHeight)/h.scrollHeight*100;
  [25,50,75,100].forEach(function(d){if(max>=d&&!sentDepths[d]){sentDepths[d]=1;post({type:'scroll',scroll_depth:d});}});
},{passive:true});
document.addEventListener('click',function(e){
  var t=e.target;while(t&&t.tagName!=='A')t=t.parentElement;
  if(!t||!t.href)return;
  try{var h=new URL(t.href).hostname.replace(/^www\\./,'');if(h&&h!==${JSON.stringify(host)})post({type:'outbound',outbound_url:t.href});}catch(_){}
  if(t.hasAttribute('data-conv'))post({type:'conversion',outbound_url:t.href});
},true);
window.addEventListener('pagehide',function(){post({type:'exit',dwell_ms:dwell});});
}catch(e){}})();`;
}
