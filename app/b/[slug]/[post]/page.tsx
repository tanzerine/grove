import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname').eq('blog_slug', slug).single();
  if (!domain) return {};
  const { data: p } = await sb.from('posts').select('meta_title,meta_description').eq('domain_id', domain.id).eq('slug', post).single();
  return {
    title: p?.meta_title,
    description: p?.meta_description,
    openGraph: { title: p?.meta_title, description: p?.meta_description, type: 'article' },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug,site_profile').eq('blog_slug', slug).single();
  if (!domain) notFound();
  const { data: p } = await sb
    .from('posts').select('title,body_md,published_at,meta_description,reads,id')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) notFound();

  // increment reads (best-effort)
  await sb.from('posts').update({ reads: (p.reads ?? 0) + 1 }).eq('id', p.id);

  const html = mdToHtml(p.body_md ?? '');
  const toc = extractToc(p.body_md ?? '');

  // CTA banner: "Try {business}" → the customer's own site (counts as a conversion).
  const profile = (domain as any).site_profile ?? null;
  const business = profile?.business ?? null;
  const businessName: string = business?.name || domain.hostname.replace(/^www\./, '');
  const subline: string = business?.value_props?.[0] || business?.description || '';
  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  return (
    <main className="post-shell">
      <a href={`/b/${slug}`} className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← {domain.hostname}</a>

      <div className="post-grid" style={{ marginTop: 18 }}>
        <div className="post-main">
          <h1 className="display" style={{ fontSize: 46 }}>{p.title}</h1>
          <p className="mono" style={{ color: 'var(--clay)', fontSize: 12 }}>{new Date(p.published_at!).toLocaleDateString()}</p>

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
