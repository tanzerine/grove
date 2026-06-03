import { supabaseServer } from '@/lib/supabase/server';
import CopySnippet from './CopySnippet';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('hostname,blog_slug').limit(1);
  const domain = domains?.[0];
  const groveBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove-red.vercel.app';

  const oneLiner = `<div id="grove-feed"></div>
<script src="${groveBase}/embed.js" async></script>`;

  return (
    <>
      <h2 className="h2">Embed on your site</h2>
      <p className="lede">
        Drop this anywhere on <span className="mono">{domain?.hostname}</span> to surface your latest grove posts.
        No slug, no API key — it auto-detects your domain.
      </p>

      <div style={{ marginTop: 28, background: 'var(--ink)', color: 'var(--bone)', padding: 24, borderRadius: 14 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--leaf)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          Snippet
        </div>
        <pre style={{ margin: 0, fontFamily: 'DM Mono, monospace', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{oneLiner}
        </pre>
        <CopySnippet snippet={oneLiner} />
      </div>

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 40 }}>How it works</h3>
      <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.8, color: 'var(--clay)' }}>
        <li>Paste the snippet anywhere on a page — landing, footer, /blog, sidebar.</li>
        <li>When the page loads, the script reads <span className="mono">window.location.hostname</span>.</li>
        <li>It calls <span className="mono">/api/embed/host/&lt;your-domain&gt;</span> on grove.</li>
        <li>Grove returns your 6 most recent published posts as a JSON feed.</li>
        <li>The script renders them as plain HTML cards. No iframe, no tracking, no third-party CSS overrides.</li>
      </ol>

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 30 }}>Customizing the styling</h3>
      <p style={{ color: 'var(--clay)', fontSize: 14 }}>
        The embedded cards inherit your site's font and color cascade where possible. To override:
      </p>
      <pre style={{ background: 'var(--paper)', padding: 16, borderRadius: 10, fontSize: 13, marginTop: 8, overflowX: 'auto' }}>
{`#grove-feed .grv-title { color: #yourbrand; }
#grove-feed .grv-card  { border-bottom-color: #yourborder; }`}
      </pre>
    </>
  );
}
