import { supabaseServer } from '@/lib/supabase/server';
import CopySnippet from './CopySnippet';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('hostname,blog_slug').limit(1);
  const domain = domains?.[0];
  const groveBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove-red.vercel.app';

  const blogSnippet = `<div id="grove-blog"></div>
<script src="${groveBase}/embed.js" async></script>`;

  const widgetSnippet = `<div id="grove-widget" data-blog-url="/blog" data-count="4"></div>
<script src="${groveBase}/embed.js" async></script>`;

  return (
    <>
      <h2 className="h2">Embed grove on your site</h2>
      <p className="lede">
        One script, zero backend. Drop a tag on <span className="mono">{domain?.hostname}</span> and grove renders
        the whole thing — it auto-detects your domain, no slug or API key.
      </p>

      {/* Full blog */}
      <SnippetCard
        kicker="1 · Full blog page"
        title="The entire blog, on your own URL"
        desc="Put this on your /blog page. You get the featured card, search, genre filters, pagination, and in-page article reading — every feature, no code to write or maintain."
        snippet={blogSnippet}
        preview={<BlogPreview />}
      />

      {/* Widget */}
      <SnippetCard
        kicker="2 · Homepage widget"
        title="A teaser that drives traffic to the blog"
        desc="Put this on your landing or home page. It shows your newest 3–4 posts and a “Read the blog →” link. Tune it with data-count and point data-blog-url at wherever you mounted the full blog."
        snippet={widgetSnippet}
        preview={<WidgetPreview />}
      />

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 40 }}>How it works</h3>
      <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.8, color: 'var(--clay)' }}>
        <li>Paste a snippet. On load, the script reads <span className="mono">window.location.hostname</span>.</li>
        <li>It calls <span className="mono">/api/embed/host/&lt;your-domain&gt;</span> on grove for your published posts.</li>
        <li>It renders styled HTML directly into the page — no iframe, no tracking pixel, no third-party CSS leaking onto your site.</li>
        <li>The full-blog mode reads articles in-page via <span className="mono">#grove/&lt;slug&gt;</span> hash routing, so your header and footer stay put.</li>
      </ol>

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 30 }}>Make it yours</h3>
      <ul style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.8, color: 'var(--clay)' }}>
        <li><span className="mono">data-accent=&quot;#hex&quot;</span> — match your brand color (links, chips, hover).</li>
        <li><span className="mono">data-article-base=&quot;/blog&quot;</span> on <span className="mono">#grove-blog</span> — link cards to your own
          server-rendered article pages (<span className="mono">/blog/&lt;slug&gt;</span>) instead of the in-page reader.
          Use this if you keep a thin article route for per-domain SEO.</li>
        <li>Cards inherit your page font automatically. Override any class under <span className="mono">.gv</span> to restyle.</li>
      </ul>

      <p style={{ color: 'var(--clay)', fontSize: 13.5, marginTop: 24 }}>
        Prefer per-article SEO credited to your own domain? Grove also hosts a fully-indexed copy at{' '}
        <span className="mono">{groveBase}/b/{domain?.blog_slug}</span> (sitemap, RSS, JSON-LD), so search engines
        find your content even with the in-page embed.
      </p>
    </>
  );
}

function SnippetCard({
  kicker, title, desc, snippet, preview,
}: { kicker: string; title: string; desc: string; snippet: string; preview?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 26, border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{kicker}</div>
        <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>{title}</div>
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '8px 0 0', lineHeight: 1.55 }}>{desc}</p>
      </div>
      {preview && (
        <div style={{ padding: '22px 22px 6px', background: 'white', borderBottom: '1px solid var(--line)' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--clay)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Preview
          </div>
          <div style={{ pointerEvents: 'none', userSelect: 'none' }} aria-hidden>{preview}</div>
        </div>
      )}
      <div style={{ background: 'var(--ink)', color: 'var(--bone)', padding: 20 }}>
        <pre style={{ margin: 0, fontFamily: 'DM Mono, monospace', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{snippet}
        </pre>
        <CopySnippet snippet={snippet} />
      </div>
    </div>
  );
}

/* ───────── tiny non-interactive mockups of each embed type ───────── */

const SKELETON = 'var(--paper)';

function MiniCard({ wide = false }: { wide?: boolean }) {
  return (
    <div style={{ flex: wide ? '1 1 100%' : '1', minWidth: 0, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
      <div style={{ height: wide ? 64 : 46, background: 'linear-gradient(135deg, #E6F0FF, #EAE3FF)' }} />
      <div style={{ padding: '8px 9px' }}>
        <div style={{ width: 34, height: 7, borderRadius: 999, background: 'rgba(78,158,106,0.25)', marginBottom: 7 }} />
        <div style={{ width: '92%', height: 7, borderRadius: 3, background: 'var(--ink)', opacity: 0.55, marginBottom: 5 }} />
        <div style={{ width: '70%', height: 6, borderRadius: 3, background: SKELETON }} />
        <div style={{ width: 50, height: 5, borderRadius: 3, background: SKELETON, marginTop: 9 }} />
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper)', padding: 14, maxWidth: 520 }}>
      {children}
    </div>
  );
}

function WidgetPreview() {
  return (
    <Frame>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ width: 60, height: 6, borderRadius: 999, background: 'rgba(78,158,106,0.35)', marginBottom: 5 }} />
          <div style={{ width: 92, height: 9, borderRadius: 3, background: 'var(--ink)', opacity: 0.7 }} />
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--moss)' }}>Read the blog →</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <MiniCard /><MiniCard /><MiniCard />
      </div>
    </Frame>
  );
}

function BlogPreview() {
  const chip = (on?: boolean) => (
    <div style={{ height: 16, width: on ? 30 : 42, borderRadius: 999, background: on ? 'var(--moss)' : 'white', border: `1px solid ${on ? 'var(--moss)' : 'var(--line)'}` }} />
  );
  return (
    <Frame>
      {/* header: title + search pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ width: 110, height: 10, borderRadius: 3, background: 'var(--ink)', opacity: 0.7 }} />
        <div style={{ width: 120, height: 20, borderRadius: 999, background: 'white', border: '1px solid var(--line)' }} />
      </div>
      {/* genre chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {chip(true)}{chip()}{chip()}{chip()}
      </div>
      {/* featured wide */}
      <div style={{ marginBottom: 10 }}><MiniCard wide /></div>
      {/* grid */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <MiniCard /><MiniCard /><MiniCard />
      </div>
      {/* pager */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 42, height: 16, borderRadius: 999, border: '1px solid var(--line)', background: 'white' }} />
        <div style={{ width: 44, height: 6, borderRadius: 3, background: SKELETON }} />
        <div style={{ width: 42, height: 16, borderRadius: 999, border: '1px solid var(--line)', background: 'white' }} />
      </div>
    </Frame>
  );
}
