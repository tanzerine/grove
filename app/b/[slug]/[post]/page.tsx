import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { isBot, jsonLdScript, blogHomeUrl, blogPostUrl, subdomainSlugFromHost } from '@/lib/seo';
import { pickRelated } from '@/lib/related-posts';
import { injectInternalLinks } from '@/lib/internal-links';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname').eq('blog_slug', slug).single();
  if (!domain) return {};
  const { data: p } = await sb
    .from('posts')
    .select('title,meta_title,meta_description,cover_image_url,published_at')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) return {};

  const url = blogPostUrl(slug, post);
  const title = p.meta_title || p.title || undefined;
  const description = p.meta_description ?? undefined;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      types: { 'application/rss+xml': `${blogHomeUrl(slug)}/rss.xml` },
    },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      siteName: domain.hostname,
      publishedTime: p.published_at ?? undefined,
      images: p.cover_image_url ? [{ url: p.cover_image_url }] : undefined,
    },
    twitter: {
      card: p.cover_image_url ? 'summary_large_image' : 'summary',
      title,
      description,
      images: p.cover_image_url ? [p.cover_image_url] : undefined,
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug,site_profile').eq('blog_slug', slug).single();
  if (!domain) notFound();
  const { data: p } = await sb
    .from('posts').select('title,body_md,published_at,meta_description,reads,id,cover_image_url,cover_image_credit')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) notFound();

  // increment reads (best-effort) — humans only; bots and link-preview
  // fetchers would otherwise skew the metric the strategy loop feeds on
  const ua = (await headers()).get('user-agent');
  if (!isBot(ua)) {
    await sb.from('posts').update({ reads: (p.reads ?? 0) + 1 }).eq('id', p.id);
  }

  // On a blog subdomain the middleware strips the /b/{slug} prefix, so
  // relative links must be root-relative there and prefixed on the app host.
  const onSubdomain = !!subdomainSlugFromHost((await headers()).get('host'));
  const prefix = onSubdomain ? '' : `/b/${slug}`;

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

  // CTA banner: "Try {business}" → the customer's own site (counts as a conversion).
  const profile = (domain as any).site_profile ?? null;
  const business = profile?.business ?? null;
  const businessName: string = business?.name || domain.hostname.replace(/^www\./, '');
  const subline: string = business?.value_props?.[0] || business?.description || '';
  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const pageUrl = blogPostUrl(slug, post);
  const credit = (p as any).cover_image_credit as { name?: string; profile_url?: string } | null;
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.meta_description ?? undefined,
    image: p.cover_image_url ?? undefined,
    datePublished: p.published_at ?? undefined,
    dateModified: p.published_at ?? undefined,
    mainEntityOfPage: pageUrl,
    author: { '@type': 'Organization', name: businessName, url: homeUrl },
    publisher: { '@type': 'Organization', name: businessName, url: homeUrl },
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: domain.hostname, item: blogHomeUrl(slug) },
      { '@type': 'ListItem', position: 2, name: p.title, item: pageUrl },
    ],
  };

  return (
    <main className="post-shell">
      <a href={prefix || '/'} className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← {domain.hostname}</a>

      <div className="post-grid" style={{ marginTop: 18 }}>
        <div className="post-main">
          <h1 className="display" style={{ fontSize: 46 }}>{p.title}</h1>
          <p className="mono" style={{ color: 'var(--clay)', fontSize: 12 }}>{new Date(p.published_at!).toLocaleDateString()}</p>

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
            style={{ marginTop: 30, padding: '40px 36px', background: 'white', border: '1px solid var(--line)', borderRadius: 14, maxWidth: 'none' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {/* "Try {business}" banner — links to the customer's site, tracked as a conversion */}
          <aside className="cta-banner">
            <div className="cta-kicker">Powered by {businessName}</div>
            <h3>Try {businessName}</h3>
            {subline && <p>{subline}</p>}
            <a className="cta-btn" href={homeUrl} target="_blank" rel="noopener noreferrer" data-conv>
              Visit {businessName} →
            </a>
          </aside>

          {related.length > 0 && (
            <section style={{ marginTop: 36 }} aria-label="Related articles">
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>
                Keep reading
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(related.length, 3)}, 1fr)`, gap: 12 }}>
                {related.map((rp) => (
                  <a
                    key={rp.slug}
                    href={`${prefix}/${rp.slug}`}
                    style={{ display: 'block', background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', textDecoration: 'none', color: 'inherit' }}
                  >
                    {rp.cover_image_url && (
                      <img src={rp.cover_image_url} alt="" loading="lazy" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
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

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }} />
      <script
        dangerouslySetInnerHTML={{
          __html: buildTrackerScript({ postId: p.id, domainId: domain.id, hostname: domain.hostname }),
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
