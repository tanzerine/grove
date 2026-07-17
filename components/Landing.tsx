'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS } from '@/lib/plans';

/* Faithful port of the "Grove Landing" design comp:
   centered refraction-beam hero, floating product mock, stat band, bento
   features, showcase tiles, testimonials, pricing, FAQ, dark CTA + footer.
   Self-contained dark skin (Plus Jakarta Sans loaded in app/layout.tsx).
   Includes the comp's scroll-reveal entrance animation + mouse-reactive beams. */

const ACCENT = '#63c281';
const GLOW = 0.6;

const CSS = `
.gv-land { --accent: ${ACCENT}; --glow: ${GLOW}; }
.gv-land ::selection { background: rgba(99,194,129,0.3); color: #fff; }
@keyframes gvDrift1 { 0% { transform: translate3d(-6%,0,0) scale(1.1); } 50% { transform: translate3d(8%,-3%,0) scale(1.25); } 100% { transform: translate3d(-6%,0,0) scale(1.1); } }
@keyframes gvDrift2 { 0% { transform: translate3d(5%,2%,0) scale(1.2); } 50% { transform: translate3d(-7%,-2%,0) scale(1.05); } 100% { transform: translate3d(5%,2%,0) scale(1.2); } }
@keyframes gvFloaty { 0% { transform: translateY(0); } 50% { transform: translateY(-10px); } 100% { transform: translateY(0); } }
@keyframes gvBeam { 0%, 100% { opacity: 0.28; transform: scaleY(1); } 50% { opacity: 0.85; transform: scaleY(1.05); } }
@keyframes gvShimmer { 0% { transform: translateX(0); } 100% { transform: translateX(26px); } }
@keyframes gvBlobdrift { 0% { transform: translate3d(-4%, 2%, 0) scale(1.1); } 50% { transform: translate3d(6%, -3%, 0) scale(1.28); } 100% { transform: translate3d(-4%, 2%, 0) scale(1.1); } }
@keyframes gvRise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gvFade { from { opacity: 0; } to { opacity: 1; } }
.gv-land .gv-link:hover { color: #eef1ea !important; }
.gv-land .gv-tile:hover .gv-tilecap { opacity: 1 !important; transform: translateY(0) !important; }
.gv-land .gv-card:hover { border-color: rgba(99,194,129,0.35) !important; transform: translateY(-3px); }
.gv-land .gv-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(99,194,129,0.25); }
.gv-land .gv-ghost:hover { background: rgba(255,255,255,0.06) !important; }
.gv-land .gv-scroll::-webkit-scrollbar { height: 6px; }
.gv-land .gv-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
.gv-land input::placeholder { color: #565a53; }
@media (max-width: 860px) {
  .gv-land .gv-bento { grid-template-columns: 1fr !important; }
  .gv-land .gv-bento > div { grid-column: auto !important; }
}
@media (max-width: 760px) {
  .gv-land .gv-faqgrid { grid-template-columns: 1fr !important; }
  .gv-land .gv-footgrid { grid-template-columns: 1fr 1fr !important; }
}
.gv-land .gv-mock-grid { display: grid; grid-template-columns: 194px 1fr; }
@media (max-width: 720px) {
  .gv-land .gv-mock-side { display: none !important; }
  .gv-land .gv-mock-grid { grid-template-columns: 1fr; }
  .gv-land .gv-mock-stats { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 720px) {
  .gv-land .gv-navlinks { display: none !important; }
  .gv-land .gv-navpill { gap: 14px !important; }
}
@media (max-width: 760px) {
  .gv-land .gv-steps3 { grid-template-columns: 1fr !important; }
  .gv-land .gv-statband { grid-template-columns: repeat(2, 1fr) !important; padding: 30px 22px !important; }
}
`;

export default function Landing({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [faqOpen, setFaqOpen] = useState<number>(0);
  const rootElRef = useRef<HTMLDivElement>(null);
  const refractRef = useRef<HTMLDivElement>(null);
  const beamsRef = useRef<HTMLDivElement>(null);

  // mouse-reactive hue/parallax on the hero refraction (port of comp's _onMove)
  useEffect(() => {
    const el = refractRef.current;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const onMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      el.style.filter = `hue-rotate(${(x * 18).toFixed(1)}deg) saturate(${(1 + x * 0.12).toFixed(3)})`;
      const beams = beamsRef.current;
      if (beams) {
        beams.style.transform = `scaleX(${(1 + x * 0.2).toFixed(3)})`;
        beams.style.filter = `brightness(${(1.05 - y * 0.45).toFixed(3)})`;
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // scroll-reveal: sections rise/fade in as they enter the viewport (port of
  // the comp's componentDidMount). Fade-only for cards, rise for blocks.
  useEffect(() => {
    const root = rootElRef.current;
    if (!root) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = Array.from(
      root.querySelectorAll<HTMLElement>('.gv-r, .gv-rf, #features .gv-card, .gv-tile, .gv-tcard, .gv-pcard, .gv-faq')
    );
    if (reduce || !targets.length) return;
    const seen = new Map<Element | null, number>();
    targets.forEach((node) => {
      const fadeOnly = node.classList.contains('gv-rf') || node.classList.contains('gv-card') || node.classList.contains('gv-tile');
      (node as any)._fadeOnly = fadeOnly;
      const parent = node.parentElement;
      const c = seen.get(parent) || 0;
      (node as any)._revDelay = Math.min(c, 6) * 70;
      seen.set(parent, c + 1);
      node.style.opacity = '0';
    });
    const reveal = (node: HTMLElement) => {
      if ((node as any)._revDone) return;
      (node as any)._revDone = true;
      const name = (node as any)._fadeOnly ? 'gvFade' : 'gvRise';
      node.style.animation = `${name} .8s cubic-bezier(.22,.61,.36,1) ${(node as any)._revDelay}ms both`;
      const dur = (node as any)._revDelay + 850;
      window.setTimeout(() => {
        node.style.animation = '';
        node.style.opacity = '';
      }, dur + 60);
    };
    let scrollFn: (() => void) | null = null;
    const check = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      let remaining = 0;
      targets.forEach((node) => {
        if ((node as any)._revDone) return;
        if (node.getBoundingClientRect().top < vh * 0.88) reveal(node);
        else remaining++;
      });
      if (!remaining && scrollFn) {
        window.removeEventListener('scroll', scrollFn);
        window.removeEventListener('resize', scrollFn);
        scrollFn = null;
      }
    };
    let ticking = false;
    scrollFn = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; check(); });
    };
    window.addEventListener('scroll', scrollFn, { passive: true });
    window.addEventListener('resize', scrollFn, { passive: true });
    requestAnimationFrame(check);
    const failsafe = window.setTimeout(() => targets.forEach(reveal), 4000);
    return () => {
      if (scrollFn) {
        window.removeEventListener('scroll', scrollFn);
        window.removeEventListener('resize', scrollFn);
      }
      clearTimeout(failsafe);
    };
  }, []);

  const clean = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/$/, '').trim().toLowerCase();
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const host = clean(domain);
    router.push(host.includes('.') ? `/signup?domain=${encodeURIComponent(host)}` : '/signup');
  };

  const startHref = loggedIn ? '/dashboard' : '/signup';
  const isMonthly = billing === 'monthly';

  const pipeline = [
    { title: '10 onboarding mistakes killing activation', meta: 'researched · 1,840 words · scheduled', status: 'publishing' },
    { title: 'How we cut SaaS churn 18% in a quarter', meta: 'drafted · in your voice', status: 'in review' },
    { title: 'A buyer’s guide to programmatic SEO', meta: 'ranking for 14 keywords', status: 'live' },
  ];
  const steps = [
    { n: '01', title: 'Plant your domain', sub: 'One field. No plugins.' },
    { n: '02', title: 'Verify ownership', sub: 'DNS or meta tag · 2 min' },
    { n: '03', title: 'You approve, it ships', sub: 'Or flip to full auto' },
  ];
  // Real publish surfaces only — grove has no WordPress/Webflow/Ghost plugin,
  // and pretending otherwise is a bait-and-switch a customer discovers on day 1.
  const platforms = ['Hosted blog', 'One-line embed', 'Webhook', 'Zapier / n8n', 'RSS', 'JSON API'];
  // Product facts, not invented social proof.
  const stats = [
    { big: '1 editor', label: 'an agent scores every draft; weak ones never ship' },
    { big: '0–100', label: 'quality score on each post before it goes live' },
    { big: '1 line', label: 'of code to run the whole blog on your site' },
    { big: '0', label: 'third-party trackers — your analytics stay yours' },
  ];
  const features = [
    { n: '01', title: 'Live SERP analysis', body: 'grove reads what’s actually ranking for your keywords, then reverse-engineers the brief — gap, intent, structure and word count.' },
    { n: '02', title: 'Written to be quoted', body: 'Structured for AI Overviews and ChatGPT — the answer engines where the next click now starts.' },
    { n: '03', title: 'Writes in your voice', body: 'Trained on your site and past posts. Reads like your best writer — not a content mill.' },
    { n: '04', title: 'Results in plain English', body: 'See exactly why each post moves — no Search Console spreadsheet required.' },
    { n: '05', title: 'Cross-posts where it counts', body: 'One brief becomes a blog post, an X thread, a LinkedIn post, and an Instagram caption.' },
    { n: '06', title: 'Publishes itself', body: 'Straight to your domain — URL, sitemap, internal links, metadata, schema. No copy-paste, no plugins.' },
  ];
  const wave = ['40%','70%','55%','85%','45%','95%','60%','75%','50%','88%','42%','66%','80%','52%','92%','58%','72%','48%','84%','62%','46%','78%'];
  const channels = ['Blog post', 'X thread', 'LinkedIn', 'Instagram'];

  // Hero product mock — mirrors the real dashboard "Overview": the SideNav
  // sections/items (app/dashboard/SideNav.tsx) and the four stat cards
  // (app/dashboard/page.tsx). Keep these in sync if the app shell changes.
  const mockNav = [
    { head: 'Create', items: [
      { label: 'Home', icon: 'home', active: true },
      { label: 'Strategy', icon: 'strategy' },
      { label: 'Write', icon: 'write' },
      { label: 'Pipeline', icon: 'pipeline', badge: 3 },
    ] },
    { head: 'Publish', items: [
      { label: 'Calendar', icon: 'calendar' },
      { label: 'Analytics', icon: 'analytics' },
    ] },
  ];
  const mockStats = [
    { label: 'Reads', value: '3.2k', delta: '+18%', tone: 'accent', sub: '142 this week' },
    { label: 'Published', value: '128', delta: '+6', tone: 'accent', sub: '4 / week' },
    { label: 'In pipeline', value: '3', delta: 'live', tone: 'dim', sub: 'on schedule' },
    { label: 'Review', value: '2', delta: 'action', tone: 'amber', sub: 'approve to publish' },
  ];
  const navIcon = (name: string) => {
    const paths: Record<string, string> = {
      home: 'M3 9l7-6 7 6M5 8.5V17h10V8.5',
      strategy: 'M10 3a7 7 0 100 14 7 7 0 000-14M10 7l2.2 4.5L8 10z',
      write: 'M4 16l1.5-.4 8.6-8.6-1.1-1.1L4.4 14.5z',
      pipeline: 'M4 6l6-2.5L16 6l-6 2.5zM4 10l6 2.5 6-2.5M4 14l6 2.5 6-2.5',
      calendar: 'M4 5h12v11H4zM4 8.5h12M8 3.5v3M12 3.5v3',
      analytics: 'M4 16V9M9.5 16V4M15 16v-6',
    };
    return (
      <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[name]} />
      </svg>
    );
  };
  // Pricing renders straight from the plan catalogue so this page can never
  // disagree with /dashboard/billing again (it did: 4/16/unlimited vs 12/40/150).
  const tierBase = (['starter', 'growth', 'agency'] as const).map((id) => ({
    name: PLANS[id].name,
    m: PLANS[id].priceUsd,
    a: Math.round(PLANS[id].priceUsd * 0.8),
    blurb: PLANS[id].blurb,
    popular: id === 'growth',
    cta: 'Start free',
    plan: id,
    feats: PLANS[id].features,
  }));
  const faqs = [
    { q: 'Do I need WordPress or any hosting?', a: 'No hosting needed. grove hosts the blog for you at no extra cost, or renders it inside any site that can take one script tag — WordPress, Webflow, Framer, Shopify, Next.js, anything — via the embed. A publish webhook can also push every post into Zapier, Make, or n8n.' },
    { q: 'Will the posts actually sound like me?', a: 'Yes. grove trains on your existing content and tone, and you can steer the voice anytime. The first few drafts calibrate fast and only get closer.' },
    { q: 'Isn’t AI content bad for SEO now?', a: 'Thin, generic AI content is. grove writes from live SERP research with real structure, sources and intent — built to earn rankings and AI citations, not to flood pages.' },
    { q: 'Can I review posts before they go live?', a: 'Always. Run in review mode and approve every post, or flip to full auto once you trust it. It’s per-domain, and your call to change anytime.' },
    { q: 'What’s the catch with the subscription?', a: 'None. Cancel anytime and keep everything published. No long contracts, no per-seat surprises, no lock-in on your own content.' },
    { q: 'How fast is the first post?', a: 'Minutes. Enter your domain, verify ownership, and grove ships the first researched draft to your queue in the same session.' },
  ];
  // Every link here must resolve — Privacy/Terms are real pages, and the dead
  // Status/Blog/Contact entries (grove.so mail doesn't resolve) are gone.
  const footcols: { head: string; links: [string, string][] }[] = [
    { head: 'Product', links: [['Features', '#features'], ['Showcase', '#showcase'], ['Pricing', '#pricing'], ['FAQ', '#faq']] },
    { head: 'Company', links: [['Get started', startHref], ['Sign in', '/login']] },
    { head: 'Legal', links: [['Privacy', '/privacy'], ['Terms', '/terms']] },
  ];

  const beam = (left: string, w: string, color: string, blur: string, dur: string, delay = '0s'): CSSProperties => ({
    position: 'absolute', top: '-8%', bottom: '-8%', left, width: w,
    background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
    filter: `blur(${blur})`, animation: `gvBeam ${dur} ease-in-out infinite`, animationDelay: delay,
  });

  const domainForm = (idSuffix: string) => (
    <form
      onSubmit={onSubmit}
      style={{ display: 'flex', gap: 8, maxWidth: 460, margin: idSuffix === '2' ? '0 auto' : '0 auto 16px', background: 'rgba(20,22,19,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 7px 7px 18px', boxShadow: '0 14px 44px rgba(0,0,0,0.5)' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', color: '#6b6f67', fontSize: 15 }}>https://</span>
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="yourdomain.com"
        aria-label="Your domain"
        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#eef1ea', fontSize: 15, fontFamily: 'inherit', minWidth: 0 }}
      />
      <button className="gv-btn" type="submit" style={{ background: 'var(--accent,#63c281)', color: '#06120b', fontWeight: 700, fontSize: 15, padding: '11px 22px', borderRadius: 999, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'transform .2s, box-shadow .2s' }}>Plant →</button>
    </form>
  );

  return (
    <div
      ref={rootElRef}
      className="gv-land"
      style={{ '--accent': ACCENT, '--glow': String(GLOW), background: '#0a0b0a', color: '#eef1ea', fontFamily: "'Plus Jakarta Sans', sans-serif", minHeight: '100vh', overflowX: 'hidden', position: 'relative', WebkitFontSmoothing: 'antialiased' } as CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* NAV */}
      <div style={{ position: 'fixed', top: 16, left: 0, right: 0, zIndex: 50, display: 'flex', justifyContent: 'center', padding: '0 20px', pointerEvents: 'none' }}>
        <div className="gv-navpill" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 28, background: 'rgba(16,18,16,0.72)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '9px 9px 9px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
          <a href="#hero" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#eef1ea' }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #9ff0bb, var(--accent,#63c281))', boxShadow: '0 0 12px rgba(99,194,129,0.7)' }} />
            <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>grove</span>
          </a>
          <div className="gv-navlinks" style={{ display: 'flex', gap: 24, fontSize: 14, fontWeight: 500 }}>
            <a className="gv-link" href="#features" style={{ color: '#9aa096', textDecoration: 'none', transition: 'color .2s' }}>Features</a>
            <a className="gv-link" href="#showcase" style={{ color: '#9aa096', textDecoration: 'none', transition: 'color .2s' }}>Showcase</a>
            <a className="gv-link" href="#pricing" style={{ color: '#9aa096', textDecoration: 'none', transition: 'color .2s' }}>Pricing</a>
            <a className="gv-link" href="#faq" style={{ color: '#9aa096', textDecoration: 'none', transition: 'color .2s' }}>FAQ</a>
          </div>
          <a className="gv-btn" href={startHref} style={{ background: 'var(--accent,#63c281)', color: '#06120b', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 999, textDecoration: 'none', transition: 'transform .2s, box-shadow .2s' }}>{loggedIn ? 'Dashboard' : 'Get started'}</a>
        </div>
      </div>

      {/* HERO */}
      <section id="hero" style={{ position: 'relative', padding: '196px 24px 104px', textAlign: 'center', overflow: 'hidden' }}>
        <div ref={refractRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', opacity: 'var(--glow,0.6)', transition: 'filter .6s ease-out', willChange: 'filter' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(130% 82% at 50% 2%, rgba(99,194,129,0.24), rgba(10,11,10,0) 56%)' }} />
          <div style={{ position: 'absolute', top: '-24%', left: '26%', width: '46%', height: '90%', background: 'radial-gradient(ellipse at center, rgba(99,194,129,0.45), rgba(99,194,129,0) 60%)', filter: 'blur(90px)', animation: 'gvBlobdrift 18s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', top: '-18%', left: '6%', width: '40%', height: '80%', background: 'radial-gradient(ellipse at center, rgba(150,230,185,0.3), rgba(150,230,185,0) 60%)', filter: 'blur(96px)', animation: 'gvBlobdrift 24s ease-in-out infinite reverse' }} />
          <div style={{ position: 'absolute', top: '-14%', right: '8%', width: '38%', height: '78%', background: 'radial-gradient(ellipse at center, rgba(70,180,140,0.32), rgba(70,180,140,0) 60%)', filter: 'blur(86px)', animation: 'gvBlobdrift 21s ease-in-out infinite' }} />
          <div ref={beamsRef} style={{ position: 'absolute', inset: 0, transformOrigin: '50% 45%', transition: 'transform .55s ease-out, filter .55s ease-out', willChange: 'transform, filter' }}>
            <div style={beam('9%', '52px', 'rgba(160,235,190,0.22)', '16px', '8s', '-1s')} />
            <div style={beam('21%', '70px', 'rgba(190,245,210,0.3)', '18px', '7s', '-3s')} />
            <div style={beam('35%', '90px', 'rgba(210,250,225,0.4)', '20px', '6.5s', '-2s')} />
            <div style={beam('49%', '110px', 'rgba(225,255,235,0.5)', '22px', '7.5s')} />
            <div style={beam('63%', '84px', 'rgba(200,248,220,0.36)', '20px', '6.8s', '-1.5s')} />
            <div style={beam('77%', '66px', 'rgba(170,238,198,0.28)', '18px', '8.2s', '-4s')} />
            <div style={beam('89%', '50px', 'rgba(150,232,185,0.2)', '16px', '7.2s', '-2.5s')} />
          </div>
          <div style={{ position: 'absolute', inset: -30, background: 'repeating-linear-gradient(90deg, transparent 0, rgba(190,245,212,0.05) 1px, transparent 2px, transparent 24px)', mixBlendMode: 'screen', animation: 'gvShimmer 9s linear infinite' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, #0a0b0a 0%, rgba(10,11,10,0) 24%, rgba(10,11,10,0) 76%, #0a0b0a 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,11,10,0) 0%, rgba(10,11,10,0) 26%, rgba(10,11,10,0.78) 48%, #0a0b0a 62%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,11,10,0.72) 0%, rgba(10,11,10,0.28) 7%, rgba(10,11,10,0) 17%)' }} />
        </div>

        <div className="gv-r" style={{ position: 'relative', maxWidth: 880, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 15px', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b6bcb1', marginBottom: 36 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent,#63c281)', boxShadow: '0 0 8px var(--accent,#63c281)' }} />
            AI marketing agent · now live
          </div>
          <h1 style={{ fontSize: 'clamp(40px, 6.4vw, 76px)', lineHeight: 1.08, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 30px', color: 'rgba(241,248,243,0.95)', textShadow: '0 2px 50px rgba(99,194,129,0.28)' }}>
            Plant your domain.<br />The blog <span style={{ color: 'var(--accent,#63c281)', fontStyle: 'italic', fontWeight: 600 }}>grows itself.</span>
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.7, color: '#9aa096', maxWidth: 600, margin: '0 auto 40px' }}>
            Your marketing agent reads what&apos;s actually ranking, writes in your voice, and publishes to your site — holding anything weak for your review. Built for Google, written to be quoted by ChatGPT &amp; AI Overviews.
          </p>
          {domainForm('1')}
          <div style={{ fontSize: 11.5, letterSpacing: '0.04em', color: '#6b6f67' }}>Free to start · First draft in minutes · No card required</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 26, fontSize: 13.5, color: '#9aa096' }}>
            An editor agent scores every draft 0–100 — weak ones never ship
          </div>
        </div>

        {/* PRODUCT MOCK */}
        <div className="gv-rf" style={{ position: 'relative', maxWidth: 920, margin: '76px auto 0', animation: 'gvFloaty 7s ease-in-out infinite' }}>
          <div style={{ position: 'absolute', inset: '12px 60px auto', height: 60, background: 'var(--accent,#63c281)', filter: 'blur(60px)', opacity: 0.3, borderRadius: '50%' }} />
          <div style={{ position: 'relative', background: 'linear-gradient(180deg, #14171400, #101310)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#2a2d29' }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#2a2d29' }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#2a2d29' }} />
              <span style={{ marginLeft: 14, fontSize: 12, color: '#6b6f67' }}>grove · dashboard</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--accent,#63c281)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent,#63c281)' }} /> autopilot on</span>
            </div>
            <div className="gv-mock-grid" style={{ minHeight: 300, textAlign: 'left' }}>
              {/* left rail — mirrors the real SideNav */}
              <div className="gv-mock-side" style={{ borderRight: '1px solid rgba(255,255,255,0.06)', padding: '15px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px 4px' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent,#63c281)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06120b', fontWeight: 800, fontSize: 13 }}>g</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#eef1ea' }}>grove</span>
                </div>
                {mockNav.map((sec) => (
                  <div key={sec.head} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#565a53', padding: '2px 10px 4px' }}>{sec.head}</div>
                    {sec.items.map((it) => (
                      <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, border: `1px solid ${it.active ? 'rgba(99,194,129,0.22)' : 'transparent'}`, background: it.active ? 'rgba(99,194,129,0.1)' : 'transparent', color: it.active ? '#eef1ea' : '#9aa096', fontSize: 12.5, fontWeight: 500 }}>
                        <span style={{ color: it.active ? 'var(--accent,#63c281)' : '#6b6f67', display: 'flex', flexShrink: 0 }}>{navIcon(it.icon)}</span>
                        <span style={{ flex: 1 }}>{it.label}</span>
                        {it.badge ? <span style={{ fontSize: 9.5, fontWeight: 700, color: '#06120b', background: 'var(--accent,#63c281)', borderRadius: 999, padding: '0 6px' }}>{it.badge}</span> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* main — Overview header, stat cards, content pipeline */}
              <div style={{ padding: 18, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#eef1ea', letterSpacing: '-0.02em' }}>Overview</div>
                    <div style={{ fontSize: 11.5, color: '#6b6f67', marginTop: 3 }}>oveners.com · autopilot active</div>
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                    <span style={{ fontSize: 11.5, color: '#b6bcb1', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '6px 11px', whiteSpace: 'nowrap' }}>Review · 2</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#06120b', background: 'var(--accent,#63c281)', borderRadius: 8, padding: '6px 13px' }}>Write</span>
                  </div>
                </div>

                <div className="gv-mock-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9, marginBottom: 16 }}>
                  {mockStats.map((s) => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 11, padding: '12px 13px' }}>
                      <div style={{ fontSize: 11, color: '#6b6f67' }}>{s.label}</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 8 }}>
                        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: '#eef1ea' }}>{s.value}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, paddingBottom: 2, color: s.tone === 'amber' ? '#e0c878' : s.tone === 'accent' ? 'var(--accent,#63c281)' : '#6b6f67' }}>{s.delta}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#565a53', marginTop: 6 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: '#6b6f67', marginBottom: 9 }}>CONTENT PIPELINE</div>
                {pipeline.map((row, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 7 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(99,194,129,0.12)', border: '1px solid rgba(99,194,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent,#63c281)', fontSize: 12, flexShrink: 0 }}>✓</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#dfe4db', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</div>
                      <div style={{ fontSize: 11, color: '#6b6f67', marginTop: 2 }}>{row.meta}</div>
                    </div>
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', color: '#b6bcb1', whiteSpace: 'nowrap' }}>{row.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3 STEPS */}
        <div className="gv-r gv-steps3" style={{ position: 'relative', maxWidth: 920, margin: '32px auto 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', textAlign: 'left' }}>
              <span style={{ fontSize: 12, color: 'var(--accent,#63c281)', border: '1px solid rgba(99,194,129,0.3)', borderRadius: 7, padding: '4px 8px' }}>{s.n}</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.title}</div>
                <div style={{ fontSize: 11.5, color: '#6b6f67' }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* LOGO ROW */}
      <section style={{ padding: '64px 24px 80px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', color: '#565a53', textTransform: 'uppercase', marginBottom: 34 }}>Works with any stack</div>
        <div className="gv-r" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '44px 64px', opacity: 0.62 }}>
          {platforms.map((p) => (
            <span key={p} style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: '#cdd2c9' }}>{p}</span>
          ))}
        </div>
      </section>

      {/* STATS */}
      <section style={{ padding: '0 24px 104px' }}>
        <div className="gv-r gv-statband" style={{ maxWidth: 1120, margin: '0 auto', background: 'linear-gradient(135deg, #0b130e, #080d0a)', border: '1px solid rgba(99,194,129,0.14)', borderRadius: 20, padding: '52px 36px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 28 }}>
          {stats.map((st) => (
            <div key={st.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(30px, 4vw, 44px)', fontWeight: 700, letterSpacing: '-0.03em', color: '#eef1ea' }}>{st.big}</div>
              <div style={{ fontSize: 13, color: '#9aa096', marginTop: 6 }}>{st.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{ padding: '48px 24px 120px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 72px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent,#63c281)', textTransform: 'uppercase', marginBottom: 16 }}>Under the hood</div>
          <h2 style={{ fontSize: 'clamp(30px, 4.6vw, 50px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: '0 0 16px' }}>A whole content team,<br /><span style={{ fontStyle: 'italic', color: 'var(--accent,#63c281)', fontWeight: 600 }}>working invisibly.</span></h2>
          <p style={{ fontSize: 16.5, color: '#9aa096', lineHeight: 1.6, margin: 0 }}>Every job a real SEO and content team would own — research, voice, optimization, distribution, measurement — running on its own.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 22 }}>
          {features.map((f) => (
            <div key={f.n} className="gv-card" style={{ background: '#111311', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 34, transition: 'border-color .25s, transform .25s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <span style={{ fontSize: 13, color: 'var(--accent,#63c281)', width: 34, height: 34, borderRadius: 9, background: 'rgba(99,194,129,0.1)', border: '1px solid rgba(99,194,129,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.n}</span>
                <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>{f.title}</h3>
              </div>
              <p style={{ fontSize: 14.5, color: '#9aa096', lineHeight: 1.6, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SHOWCASE */}
      <section id="showcase" style={{ padding: '56px 24px 120px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24, marginBottom: 52 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent,#63c281)', textTransform: 'uppercase', marginBottom: 14 }}>Inside the product</div>
            <h2 style={{ fontSize: 'clamp(30px, 4.6vw, 50px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: 0 }}>See it <span style={{ fontStyle: 'italic', color: 'var(--accent,#63c281)', fontWeight: 600 }}>actually work.</span></h2>
          </div>
          <p style={{ fontSize: 15.5, color: '#9aa096', maxWidth: 360, lineHeight: 1.6, margin: 0 }}>From SERP gap to published post — every surface of the engine, monochrome and out of your way.</p>
        </div>
        <div className="gv-bento" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20 }}>
          <div className="gv-tile" style={{ gridColumn: 'span 4', position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(160deg, #14171400, #0e110e)', minHeight: 300, padding: 26 }}>
            <div style={{ fontSize: 11, color: '#6b6f67', letterSpacing: '0.1em' }}>SERP GAP ANALYSIS · "ai onboarding checklist"</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 170, marginTop: 28 }}>
              {['38%','56%','47%','92%','64%','50%','72%'].map((h, i) => (
                <div key={i} style={{ flex: 1, background: i === 3 ? 'linear-gradient(180deg, var(--accent,#63c281), rgba(99,194,129,0.3))' : 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))', borderRadius: '8px 8px 0 0', height: h, boxShadow: i === 3 ? '0 0 24px rgba(99,194,129,0.4)' : 'none' }} />
              ))}
            </div>
            <div className="gv-tilecap" style={{ position: 'absolute', left: 26, bottom: 22, opacity: 0, transform: 'translateY(8px)', transition: '.3s', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--accent,#63c281)' }}>●</span> Your opening — the gap nobody filled</div>
          </div>

          <div className="gv-tile" style={{ gridColumn: 'span 2', position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#0e110e', minHeight: 300, padding: 24 }}>
            <div style={{ fontSize: 11, color: '#6b6f67', letterSpacing: '0.1em' }}>VOICE TRAINED</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 56, marginTop: 30 }}>
              {wave.map((h, i) => (
                <span key={i} style={{ flex: 1, borderRadius: 99, background: 'var(--accent,#63c281)', height: h, opacity: 0.85 }} />
              ))}
            </div>
            <p style={{ fontSize: 13.5, color: '#9aa096', lineHeight: 1.55, margin: '26px 0 0' }}>Trained on 128 of your posts. Reads like your best writer — never a content mill.</p>
            <div className="gv-tilecap" style={{ position: 'absolute', left: 24, bottom: 22, opacity: 0, transform: 'translateY(8px)', transition: '.3s', fontSize: 13, fontWeight: 600, color: 'var(--accent,#63c281)' }}>Tone match · 97%</div>
          </div>

          <div className="gv-tile" style={{ gridColumn: 'span 2', position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#0e110e', minHeight: 230, padding: 24 }}>
            <div style={{ fontSize: 11, color: '#6b6f67', letterSpacing: '0.1em' }}>CROSS-POST COMPOSER</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 22 }}>
              {channels.map((c) => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent,#63c281)' }} />{c}<span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6b6f67' }}>queued</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gv-tile" style={{ gridColumn: 'span 2', position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(160deg, #16191600, #0e110e)', minHeight: 230, padding: 24 }}>
            <div style={{ fontSize: 11, color: '#6b6f67', letterSpacing: '0.1em' }}>RANK MOVEMENT · ILLUSTRATIVE</div>
            <svg viewBox="0 0 240 110" preserveAspectRatio="none" style={{ width: '100%', height: 120, marginTop: 18 }}>
              <polyline points="0,95 40,86 80,72 120,60 160,38 200,24 240,10" fill="none" stroke="var(--accent,#63c281)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="240" cy="10" r="4" fill="var(--accent,#63c281)" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#9aa096', marginTop: 14 }}><span>Position 18 → 3</span><span style={{ color: 'var(--accent,#63c281)', fontWeight: 600 }}>sample data</span></div>
          </div>

          <div className="gv-tile" style={{ gridColumn: 'span 2', position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#0e110e', minHeight: 230, padding: 24 }}>
            <div style={{ fontSize: 11, color: '#6b6f67', letterSpacing: '0.1em' }}>AUTO-PUBLISH</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 22, fontSize: 11.5, color: '#9aa096' }}>
              <div style={{ color: 'var(--accent,#63c281)' }}>✓ slug + canonical URL</div>
              <div style={{ color: 'var(--accent,#63c281)' }}>✓ sitemap + schema</div>
              <div style={{ color: 'var(--accent,#63c281)' }}>✓ internal links woven</div>
              <div style={{ color: 'var(--accent,#63c281)' }}>✓ metadata + OG image</div>
              <div style={{ color: '#6b6f67' }}>→ pushed to /blog · live</div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '56px 24px 120px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 52px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent,#63c281)', textTransform: 'uppercase', marginBottom: 14 }}>Plans</div>
          <h2 style={{ fontSize: 'clamp(30px, 4.6vw, 50px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: '0 0 24px' }}>Cheaper than <span style={{ fontStyle: 'italic', color: 'var(--accent,#63c281)', fontWeight: 600 }}>one freelance post.</span></h2>
          <div style={{ display: 'inline-flex', padding: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, gap: 4 }}>
            <button onClick={() => setBilling('monthly')} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, padding: '8px 20px', borderRadius: 999, transition: '.2s', background: isMonthly ? 'var(--accent,#63c281)' : 'transparent', color: isMonthly ? '#06120b' : '#9aa096' }}>Monthly</button>
            <button onClick={() => setBilling('annual')} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, padding: '8px 20px', borderRadius: 999, transition: '.2s', background: !isMonthly ? 'var(--accent,#63c281)' : 'transparent', color: !isMonthly ? '#06120b' : '#9aa096' }}>Annual <span style={{ fontSize: 11, opacity: 0.8 }}>−20%</span></button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22, alignItems: 'start' }}>
          {tierBase.map((t) => (
            <div key={t.name} className="gv-pcard" style={{ position: 'relative', background: t.popular ? 'linear-gradient(180deg, #0c130e, #090e0b)' : '#0f110f', border: `1px solid ${t.popular ? 'rgba(99,194,129,0.32)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 18, padding: '38px 32px' }}>
              {t.popular && <span style={{ position: 'absolute', top: 20, right: 22, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#06120b', background: 'var(--accent,#63c281)', padding: '4px 10px', borderRadius: 999, fontWeight: 600 }}>Most popular</span>}
              <div style={{ fontSize: 15, fontWeight: 600, color: '#cdd2c9' }}>{t.name}</div>
              <div style={{ fontSize: 13, color: '#6b6f67', margin: '4px 0 20px', minHeight: 36 }}>{t.blurb}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em' }}>${isMonthly ? t.m : t.a}</span>
                <span style={{ fontSize: 14, color: '#6b6f67', marginBottom: 10 }}>/mo</span>
              </div>
              <div style={{ fontSize: 11, color: '#565a53', marginBottom: 22, minHeight: 14 }}>{isMonthly ? 'billed monthly' : 'billed annually'}</div>
              <a className="gv-btn" href={`/signup?plan=${t.plan}`} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', border: `1px solid ${t.popular ? 'var(--accent,#63c281)' : 'rgba(255,255,255,0.18)'}`, background: t.popular ? 'var(--accent,#63c281)' : 'transparent', color: t.popular ? '#06120b' : '#eef1ea', fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, padding: 13, borderRadius: 11, cursor: 'pointer', marginBottom: 24, transition: 'transform .2s, box-shadow .2s' }}>{t.cta}</a>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {t.feats.map((ft, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: '#b6bcb1', lineHeight: 1.5 }}><span style={{ color: 'var(--accent,#63c281)', flexShrink: 0 }}>✓</span>{ft}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: '56px 24px 120px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-faqgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 56, alignItems: 'start' }}>
          <div className="gv-r">
            <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent,#63c281)', textTransform: 'uppercase', marginBottom: 14 }}>FAQ</div>
            <h2 style={{ fontSize: 'clamp(30px, 4.4vw, 46px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: '0 0 16px' }}>The honest <span style={{ fontStyle: 'italic', color: 'var(--accent,#63c281)', fontWeight: 600 }}>FAQ.</span></h2>
            <p style={{ fontSize: 15, color: '#9aa096', lineHeight: 1.6, margin: '0 0 22px' }}>The questions skeptical founders actually ask before handing over their blog.</p>
            <a className="gv-btn" href={startHref} style={{ display: 'inline-block', background: 'var(--accent,#63c281)', color: '#06120b', fontWeight: 700, fontSize: 14, padding: '12px 22px', borderRadius: 999, textDecoration: 'none', transition: 'transform .2s, box-shadow .2s' }}>Start free →</a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {faqs.map((f, i) => {
              const open = faqOpen === i;
              return (
                <div key={i} className="gv-faq" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, background: '#111311', overflow: 'hidden' }}>
                  <button onClick={() => setFaqOpen(open ? -1 : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '18px 20px', color: '#eef1ea', fontFamily: 'inherit', fontSize: 15, fontWeight: 600 }}>
                    <span style={{ flex: 1 }}>{f.q}</span>
                    <span style={{ color: 'var(--accent,#63c281)', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{open ? '–' : '+'}</span>
                  </button>
                  {open && <div style={{ padding: '0 20px 20px', fontSize: 14, color: '#9aa096', lineHeight: 1.62 }}>{f.a}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ position: 'relative', padding: '140px 24px 150px', textAlign: 'center', overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ position: 'absolute', inset: 'auto -20% -30% -20%', height: 460, pointerEvents: 'none', opacity: 'var(--glow,0.5)' }}>
          <div style={{ position: 'absolute', bottom: 0, left: '16%', width: '60%', height: 340, background: 'radial-gradient(ellipse at center, rgba(99,194,129,0.45), rgba(99,194,129,0) 62%)', filter: 'blur(70px)', animation: 'gvDrift2 18s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '4%', right: '8%', width: '46%', height: 280, background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.14), rgba(255,255,255,0) 60%)', filter: 'blur(70px)', animation: 'gvDrift1 24s ease-in-out infinite' }} />
        </div>
        <div className="gv-r" style={{ position: 'relative', maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent,#63c281)', marginBottom: 24 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent,#63c281)', boxShadow: '0 0 8px var(--accent,#63c281)' }} /> Available for new domains</div>
          <h2 style={{ fontSize: 'clamp(38px, 6vw, 68px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: '0 0 26px' }}>Your blog is one<br /><span style={{ fontStyle: 'italic', color: 'var(--accent,#63c281)', fontWeight: 600 }}>field away.</span></h2>
          <p style={{ fontSize: 17, color: '#9aa096', margin: '0 0 32px' }}>Plant your domain tonight. Wake up to a researched draft in your queue — approve it, and it&apos;s live.</p>
          {domainForm('2')}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '56px 24px 36px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r gv-footgrid" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 32, marginBottom: 44 }}>
          <div>
            <a href="#hero" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#eef1ea', marginBottom: 14 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #9ff0bb, var(--accent,#63c281))', boxShadow: '0 0 12px rgba(99,194,129,0.6)' }} />
              <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>grove</span>
            </a>
            <p style={{ fontSize: 13.5, color: '#6b6f67', lineHeight: 1.6, maxWidth: 260, margin: '0 0 16px' }}>The marketing agent that plants your domain once and grows the blog forever.</p>
            <a className="gv-btn" href={startHref} style={{ display: 'inline-block', background: 'var(--accent,#63c281)', color: '#06120b', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 999, textDecoration: 'none', transition: 'transform .2s, box-shadow .2s' }}>{loggedIn ? 'Open dashboard' : 'Start free'} →</a>
          </div>
          {footcols.map((col) => (
            <div key={col.head}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565a53', marginBottom: 16 }}>{col.head}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {col.links.map(([label, href]) => (
                  <a key={label} className="gv-link" href={href} style={{ fontSize: 13.5, color: '#9aa096', textDecoration: 'none', transition: 'color .2s' }}>{label}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11.5, color: '#565a53' }}>
          <span>© 2026 grove — plant once, grows forever.</span>
        </div>
      </footer>
    </div>
  );
}
