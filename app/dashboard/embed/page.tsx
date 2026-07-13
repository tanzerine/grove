import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import CopySnippet from './CopySnippet';
import CanonicalBaseForm from './CanonicalBaseForm';
import CustomHostnameForm from './CustomHostnameForm';
import BannerLinkForm from './BannerLinkForm';
import ThemeColorsForm from './ThemeColorsForm';
import { resolveBranding } from '@/lib/blog-theme';
import { DashHeader } from '../gv-chrome';

export default async function Page() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const groveBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://trygroveai.com';

  const blogSnippet = `<div id="grove-blog"></div>
<script src="${groveBase}/embed.js" async></script>`;

  const widgetSnippet = `<div id="grove-widget" data-blog-url="/blog" data-count="4"></div>
<script src="${groveBase}/embed.js" async></script>`;

  // Seed the color picker from the effective palette (manual override if set,
  // else crawled), and remember the crawled primary for the reset button.
  const effective = domain ? resolveBranding(domain) : null;
  const crawledPrimary = (domain as any)?.site_profile?.branding?.primary_color ?? null;
  const hasOverride = !!(domain as any)?.brand_override?.primary_color;

  return (
    <>
      <DashHeader title="Your blog, everywhere" subtitle="your domain owns the search results — embeds handle the display" />
      <div className="gv-body">
      <p className="lede">
        Two independent things, one page: put the blog on <em>your domain</em> (that&rsquo;s what Google credits —
        step 1 is the only one that matters for SEO), and optionally show posts inside your existing site with a
        copy-paste embed.
      </p>

      {domain && (
        <div style={{ marginTop: 26, border: '1px solid var(--gv-accent)', borderRadius: 14, padding: '22px 24px', background: 'var(--gv-card)' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--gv-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            1 · Own the SEO — zero code
          </div>
          <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>
            Serve the whole blog on your own subdomain
          </div>
          <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 14px', lineHeight: 1.55 }}>
            Pick a subdomain like <span className="mono">blog.{domain.hostname.replace(/^www\./, '')}</span>, save it,
            add the one DNS record we give you — done. Grove serves everything there (pages, canonicals, JSON-LD,
            sitemap, RSS, robots.txt, llms.txt, analytics), so search equity lands on{' '}
            <span className="mono">{domain.hostname.replace(/^www\./, '')}</span> with nothing to build or maintain.
          </p>
          <CustomHostnameForm
            domainId={domain.id}
            initial={(domain as any).custom_blog_hostname ?? null}
            hostname={domain.hostname}
          />
        </div>
      )}

      {/* Full blog */}
      <SnippetCard
        kicker="2 · Full blog embed"
        title="The entire blog, inside your site"
        desc="Put this on your /blog page. You get the featured card, search, genre filters, pagination, and in-page article reading — no code to write or maintain. For your visitors: the in-page reader isn't crawlable, so your search presence comes from step 1, not from this."
        snippet={blogSnippet}
        preview={<BlogPreview />}
      />

      {/* Widget */}
      <SnippetCard
        kicker="3 · Homepage widget"
        title="A teaser that drives traffic to the blog"
        desc="Put this on your landing or home page. It shows your newest 3–4 posts and a “Read the blog →” link. Tune it with data-count and point data-blog-url at your blog (from step 1, or wherever you mounted the full embed)."
        snippet={widgetSnippet}
        preview={<WidgetPreview />}
      />

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 40 }}>How it works</h3>
      <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.8, color: 'var(--gv-dim)' }}>
        <li>Paste a snippet. On load, the script reads <span className="mono">window.location.hostname</span>.</li>
        <li>It calls <span className="mono">/api/embed/host/&lt;your-domain&gt;</span> on grove for your published posts.</li>
        <li>It renders styled HTML directly into the page — no iframe, no tracking pixel, no third-party CSS leaking onto your site.</li>
        <li>The full-blog mode reads articles in-page via <span className="mono">#grove/&lt;slug&gt;</span> hash routing, so your header and footer stay put.</li>
      </ol>

      <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 30 }}>Make it yours</h3>
      <ul style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.8, color: 'var(--gv-dim)' }}>
        <li><span className="mono">data-accent=&quot;#hex&quot;</span> — match your brand color (links, chips, hover).</li>
        <li><span className="mono">data-article-base=&quot;/blog&quot;</span> on <span className="mono">#grove-blog</span> — link cards to your own
          server-rendered article pages (<span className="mono">/blog/&lt;slug&gt;</span>) instead of the in-page reader.
          Use this if you keep a thin article route for per-domain SEO.</li>
        <li>Cards inherit your page font automatically. Override any class under <span className="mono">.gv</span> to restyle.</li>
      </ul>

      {domain && (
        <details style={{ marginTop: 26, border: '1px solid var(--gv-line)', borderRadius: 14, background: 'var(--gv-card)' }}>
          <summary style={{ padding: '18px 24px', cursor: 'pointer', listStyle: 'none' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--gv-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Advanced · serve articles yourself
            </span>
            <span style={{ display: 'block', fontFamily: 'Clash Display', fontSize: 18, marginTop: 4 }}>
              I already render articles on my own site — make those pages canonical
            </span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--gv-dim)', marginTop: 4, lineHeight: 1.5 }}>
              Only for sites with their own server-rendered <span className="mono">/blog/&lt;slug&gt;</span> route or reverse
              proxy. If that&rsquo;s not you, step 1 above does everything with zero code.
            </span>
          </summary>
          <div style={{ padding: '0 24px 22px' }}>
            <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 14px', lineHeight: 1.55 }}>
              Set the base URL your articles live under. Every absolute URL grove emits (rel=canonical, Open Graph,
              JSON-LD, sitemap, RSS, llms.txt, social shares, embed links) flips to{' '}
              <span className="mono">{'{base}/{slug}'}</span>, so search equity compounds on{' '}
              <span className="mono">{domain.hostname}</span>. The hosted copy at{' '}
              <span className="mono">{groveBase}/b/{domain.blog_slug}</span> stays up as a non-canonical mirror.
              This wins over step 1&rsquo;s subdomain if both are set.
            </p>
            <CanonicalBaseForm
              domainId={domain.id}
              initial={(domain as any).canonical_blog_base ?? null}
              hostname={domain.hostname}
            />
            <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: '14px 0 0', lineHeight: 1.6 }}>
              Then add one line to <span className="mono">https://{domain.hostname.replace(/^www\./, '')}/robots.txt</span> so
              Google accepts the cross-hosted sitemap for your URLs:{' '}
              <span className="mono">Sitemap: {groveBase}/b/{domain.blog_slug}/sitemap.xml</span>
            </p>
          </div>
        </details>
      )}

      {domain && (
        <div style={{ marginTop: 26, border: '1px solid var(--gv-line)', borderRadius: 14, padding: '22px 24px', background: 'var(--gv-card)' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--gv-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            4 · Theme colors
          </div>
          <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>
            Set your blog&rsquo;s brand colors
          </div>
          <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 16px', lineHeight: 1.55 }}>
            Grove reads these from <span className="mono">{domain.hostname.replace(/^www\./, '')}</span> automatically, and
            they color the banner, table of contents, tags, and card accents across your whole blog. If the guess is off
            — or your brand differs from your site — set them by hand here. Your choice wins over the crawled colors and
            survives future re-crawls.
          </p>
          <ThemeColorsForm
            domainId={domain.id}
            initialPrimary={effective?.primary_color ?? '#4e9e6a'}
            initialSecondary={effective?.secondary_color ?? '#2f6b4f'}
            hasOverride={hasOverride}
            crawledPrimary={crawledPrimary}
          />
        </div>
      )}

      {domain && (
        <div style={{ marginTop: 26, border: '1px solid var(--gv-line)', borderRadius: 14, padding: '22px 24px', background: 'var(--gv-card)' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--gv-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            5 · Banner link
          </div>
          <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>
            Choose where the “Try {(domain as any).site_profile?.business?.name || domain.hostname.replace(/^www\./, '')}” banner sends readers
          </div>
          <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 14px', lineHeight: 1.55 }}>
            Every article ends with a call-to-action banner in your brand colors. By default it links to your
            homepage — point it at a signup, pricing, or campaign page instead. Clicks are tracked as conversions
            either way.
          </p>
          <BannerLinkForm
            domainId={domain.id}
            initial={(domain as any).cta_url ?? null}
            hostname={domain.hostname}
          />
        </div>
      )}

      <p style={{ color: 'var(--gv-dim)', fontSize: 13.5, marginTop: 24 }}>
        Haven&rsquo;t set up step 1 yet? Grove hosts your blog at{' '}
        <span className="mono">{groveBase}/b/{domain?.blog_slug}</span> (sitemap, RSS, JSON-LD) in the meantime —
        but that credit goes to grove&rsquo;s domain, not yours. Setting your subdomain moves it to you.
      </p>
      </div>
    </>
  );
}

function SnippetCard({
  kicker, title, desc, snippet, preview,
}: { kicker: string; title: string; desc: string; snippet: string; preview?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 26, border: '1px solid var(--gv-line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', background: 'var(--gv-card)', borderBottom: '1px solid var(--gv-line)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--gv-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{kicker}</div>
        <div style={{ fontFamily: 'Clash Display', fontSize: 20, marginTop: 4 }}>{title}</div>
        <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 0', lineHeight: 1.55 }}>{desc}</p>
      </div>
      {preview && (
        <div style={{ padding: '22px 22px 6px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--gv-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
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
        <div className="mono" style={{ fontSize: 10, color: 'var(--gv-accent)' }}>Read the blog →</div>
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
        <div style={{ width: 120, height: 20, borderRadius: 999, background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)' }} />
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
