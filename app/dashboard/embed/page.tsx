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
      />

      {/* Widget */}
      <SnippetCard
        kicker="2 · Homepage widget"
        title="A teaser that drives traffic to the blog"
        desc="Put this on your landing or home page. It shows your newest 3–4 posts and a “Read the blog →” link. Tune it with data-count and point data-blog-url at wherever you mounted the full blog."
        snippet={widgetSnippet}
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
  kicker, title, desc, snippet,
}: { kicker: string; title: string; desc: string; snippet: string }) {
  return (
    <div style={{ marginTop: 26, border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{kicker}</div>
        <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>{title}</div>
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '8px 0 0', lineHeight: 1.55 }}>{desc}</p>
      </div>
      <div style={{ background: 'var(--ink)', color: 'var(--bone)', padding: 20 }}>
        <pre style={{ margin: 0, fontFamily: 'DM Mono, monospace', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{snippet}
        </pre>
        <CopySnippet snippet={snippet} />
      </div>
    </div>
  );
}
