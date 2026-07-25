import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import CanonicalBaseForm from './CanonicalBaseForm';
import CustomHostnameForm from './CustomHostnameForm';
import BannerLinkForm from './BannerLinkForm';
import ThemeColorsForm from './ThemeColorsForm';
import EmbedTabs from './EmbedTabs';
import { resolveBranding } from '@/lib/blog-theme';
import { DashHeader } from '../gv-chrome';
import Icon from '../gv-icons';

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
  const connected = !!(domain as any)?.custom_blog_hostname;
  const apex = domain?.hostname.replace(/^www\./, '') ?? 'yoursite.com';

  return (
    <>
      <DashHeader title="Embed" subtitle="your blog, everywhere" />
      <div className="gv-body">
        <p style={{ fontSize: 14, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '0 0 22px', maxWidth: 620 }}>
          Your domain carries the SEO. Embeds are optional on top — they just show posts inside pages you already have.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

            {/* STEP 1: SUBDOMAIN */}
            <div className="gv-card" style={{ background: 'var(--gv-card)', border: `1px solid ${connected ? 'rgba(162,255,1,0.35)' : 'var(--gv-line)'}`, borderRadius: 18, padding: '22px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Step 1 · Own the SEO</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: connected ? '#d9ff8f' : 'var(--gv-dim)', background: connected ? 'rgba(162,255,1,0.14)' : 'rgba(255,255,255,0.05)', border: `1px solid ${connected ? 'rgba(162,255,1,0.4)' : 'rgba(255,255,255,0.14)'}`, borderRadius: 999, padding: '4px 10px', flexShrink: 0 }}>{connected ? 'Connected' : 'Not connected'}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>Serve the blog on your own subdomain</div>
              <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 640 }}>
                Point a subdomain at grove — we handle pages, canonicals, sitemap and search credit. Zero code.
              </p>
              {domain ? (
                <CustomHostnameForm domainId={domain.id} initial={(domain as any).custom_blog_hostname ?? null} hostname={domain.hostname} />
              ) : (
                <p style={{ color: 'var(--gv-faint)', fontSize: 13 }}>Connect a domain first.</p>
              )}
            </div>

            {/* STEP 2: EMBEDS */}
            <EmbedTabs blogSnippet={blogSnippet} widgetSnippet={widgetSnippet} />

            {/* STEP 3: CUSTOMIZE */}
            {domain && (
              <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>Step 3 · Make it yours</div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 16 }}>Brand &amp; destination</div>

                <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: 11, color: 'var(--gv-faint)', marginBottom: 10 }}>Colors — banner, buttons &amp; accents</div>
                  <ThemeColorsForm
                    domainId={domain.id}
                    initialPrimary={effective?.primary_color ?? '#4e9e6a'}
                    initialSecondary={effective?.secondary_color ?? '#2f6b4f'}
                    hasOverride={hasOverride}
                    crawledPrimary={crawledPrimary}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--gv-faint)', marginBottom: 10 }}>
                    Where the &ldquo;Try {(domain as any).site_profile?.business?.name || apex}&rdquo; banner sends readers
                  </div>
                  <BannerLinkForm domainId={domain.id} initial={(domain as any).cta_url ?? null} hostname={domain.hostname} />
                </div>
              </div>
            )}

            {/* ADVANCED: serve articles yourself */}
            {domain && (
              <details className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18 }}>
                <summary style={{ padding: '18px 22px', cursor: 'pointer', listStyle: 'none' }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Advanced · serve articles yourself</span>
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 700, marginTop: 6 }}>I already render articles on my own site — make those pages canonical</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--gv-dim)', marginTop: 6, lineHeight: 1.5 }}>
                    Only for sites with their own server-rendered <span className="mono">/blog/&lt;slug&gt;</span> route or reverse proxy. If that&rsquo;s not you, step 1 above does everything with zero code.
                  </span>
                </summary>
                <div style={{ padding: '0 22px 22px' }}>
                  <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: '8px 0 14px', lineHeight: 1.55 }}>
                    Set the base URL your articles live under. Every absolute URL grove emits (rel=canonical, Open Graph,
                    JSON-LD, sitemap, RSS, llms.txt, social shares, embed links) flips to{' '}
                    <span className="mono">{'{base}/{slug}'}</span>, so search equity compounds on{' '}
                    <span className="mono">{domain.hostname}</span>. The hosted copy at{' '}
                    <span className="mono">{groveBase}/b/{domain.blog_slug}</span> stays up as a non-canonical mirror.
                    This wins over step 1&rsquo;s subdomain if both are set.
                  </p>
                  <CanonicalBaseForm domainId={domain.id} initial={(domain as any).canonical_blog_base ?? null} hostname={domain.hostname} />
                  <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', margin: '14px 0 0', lineHeight: 1.6 }}>
                    Then add one line to <span className="mono">https://{apex}/robots.txt</span> so
                    Google accepts the cross-hosted sitemap for your URLs:{' '}
                    <span className="mono">Sitemap: {groveBase}/b/{domain.blog_slug}/sitemap.xml</span>
                  </p>
                </div>
              </details>
            )}

            <p style={{ color: 'var(--gv-faint)', fontSize: 12.5, lineHeight: 1.55 }}>
              Haven&rsquo;t set up step 1 yet? Grove hosts your blog at{' '}
              <span className="mono">{groveBase}/b/{domain?.blog_slug}</span> (sitemap, RSS, JSON-LD) in the meantime —
              but that credit goes to grove&rsquo;s domain, not yours. Setting your subdomain moves it to you.
            </p>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'sticky', top: 84 }}>
            <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Setup status</div>
              <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 16 }}>what&rsquo;s live right now</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ display: 'flex', color: connected ? 'var(--gv-accent-ink)' : '#4c4f47' }}><Icon name={connected ? 'check' : 'clock'} size={15} /></span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--gv-soft)' }}>Subdomain</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: connected ? '#d9ff8f' : 'var(--gv-dim)' }}>{connected ? 'Live' : 'Not connected'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="embed" size={15} /></span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--gv-soft)' }}>Full blog embed</span>
                  <span style={{ fontSize: 11, color: 'var(--gv-fainter)' }}>on /blog</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="overview" size={15} /></span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--gv-soft)' }}>Homepage widget</span>
                  <span style={{ fontSize: 11, color: 'var(--gv-fainter)' }}>4 latest</span>
                </div>
              </div>
            </div>

            <details className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
              <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', listStyle: 'none', fontSize: 14, fontWeight: 700 }}>
                <span>How embeds work</span><span style={{ color: 'var(--gv-faint)' }}>⌄</span>
              </summary>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 8 }}>Under the hood</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— Paste a snippet — on load, it reads window.location.hostname.</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— Calls grove for your published posts on that domain.</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— Renders styled HTML directly — no iframe, no tracking pixel.</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— Full-blog mode reads articles in-page via hash routing, so your header and footer stay put.</div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 8 }}>Customization attrs</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— <span className="mono">data-accent=&quot;#hex&quot;</span> — match links, chips and hover states to your brand.</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— <span className="mono">data-article-base=&quot;/blog&quot;</span> — link cards to your own article pages instead of the in-page reader.</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>— Cards inherit your page font automatically; override anything under <span className="mono">.gv</span> to restyle.</div>
                  </div>
                </div>
                <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 11.5, color: 'var(--gv-fainter)', lineHeight: 1.5 }}>
                  Already server-rendering /blog/&lt;slug&gt; yourself? Point data-article-base there instead — only needed if that&rsquo;s you.
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
