'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GroveEmbed from '@/components/GroveEmbed';
import SiteNav from '@/components/SiteNav';
import { ANNUAL_DISCOUNT, PLANS, formatUsd, monthlyPriceUsd, yearlyPriceUsd } from '@/lib/plans';

/* Faithful port of the "Grove Landing" design comp (dark / accent #A2FF01,
   GT Walsheim display + Inter body). Structure, spacing and every animation
   follow the comp:
     · gvRise / gvRiseLeft / gvFade  — IntersectionObserver scroll reveal
     · gvScanMove + gvPulse          — the cycling "agent working" glow sweep
     · gvMarqueeL / gvMarqueeR       — the two embed card marquees
   Data that makes public claims (pricing, platforms, stats) is sourced from
   the app, not the comp — see the notes at each array. */

const ACCENT = '#A2FF01';

const CSS = `
/* Only weight 500 is used on this page (h1 + h2Style) — declared once, at
   the exact weight requested, so the browser never needs to synthesize or
   fall back mid-session. font-display:block + the <link rel="preload"> in
   app/page.tsx keep the swap-to-fallback window imperceptibly short and
   permanent (no reverting after it lands). */
@font-face { font-family: 'GT Walsheim'; src: url('/fonts/GTWalsheim-Medium.otf') format('opentype'); font-weight: 500; font-style: normal; font-display: block; }

.gv-land { --accent: ${ACCENT}; color: #f4f4f2; font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; min-height: 100vh; overflow-x: hidden; position: relative; -webkit-font-smoothing: antialiased; background-color: #000; }
.gv-land ::selection { background: rgba(162,255,1,0.28); color: #0a0a08; }
@keyframes gvPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
@keyframes gvFocusFlash { 0%,100% { opacity: 1; } 50% { opacity: 0.15; } }
@keyframes gvScanMove { from { transform: translateY(-130%); } to { transform: translateY(230%); } }
@keyframes gvRise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gvRiseLeft { from { opacity: 0; transform: translateX(-32px); } to { opacity: 1; transform: translateX(0); } }
@keyframes gvFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gvMarqueeL { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes gvMarqueeR { from { transform: translateX(-50%); } to { transform: translateX(0); } }
.gv-land .gv-navlink { transition: color .2s; }
.gv-land .gv-navlink:hover { color: #f4f4f2 !important; }
.gv-land .gv-accentlink:hover { color: var(--accent) !important; }
.gv-land .gv-card { transition: border-color .25s, transform .25s; }
.gv-land .gv-card:hover { border-color: rgba(255,255,255,0.22) !important; transform: translateY(-2px); }
.gv-land .gv-btn { transition: transform .18s, box-shadow .18s, opacity .18s; }
.gv-land .gv-btn:hover { transform: translateY(-2px); opacity: 0.92; }
.gv-land .gv-ghost:hover { background: rgba(255,255,255,0.06) !important; }
.gv-land .gv-row:hover { background: rgba(255,255,255,0.03) !important; }
.gv-land input::placeholder { color: #55564f; }

@media (max-width: 900px) {
  .gv-land .gv-mockside { display: none !important; }
  .gv-land .gv-dashstats { grid-template-columns: repeat(2, 1fr) !important; }
  .gv-land .gv-dashsplit { grid-template-columns: 1fr !important; }
  .gv-land .gv-chatpanel { display: none !important; }
  .gv-land .gv-bento { grid-template-columns: 1fr !important; grid-template-rows: none !important; height: auto !important; }
  .gv-land .gv-bento > div { grid-column: auto !important; grid-row: auto !important; }
  .gv-land .gv-pricegrid { grid-template-columns: 1fr 1fr !important; }
  .gv-land .gv-faqgrid { grid-template-columns: 1fr !important; }
  .gv-land .gv-strategysplit { grid-template-columns: 1fr !important; }
}
@media (max-width: 700px) {
  .gv-land .gv-navlinks { display: none !important; }
  .gv-land .gv-steps3 { grid-template-columns: 1fr !important; }
  .gv-land .gv-statstrip { grid-template-columns: repeat(2, 1fr) !important; }
  .gv-land .gv-pricegrid { grid-template-columns: 1fr !important; }
  .gv-land .gv-footgrid { grid-template-columns: 1fr 1fr !important; }
  .gv-land .gv-dashstats { grid-template-columns: 1fr 1fr !important; }
}
@media (prefers-reduced-motion: reduce) {
  .gv-land *, .gv-land *::before, .gv-land *::after { animation: none !important; }
}
`;

export default function Landing({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [faqOpen, setFaqOpen] = useState<number>(0);
  const [focusStep, setFocusStep] = useState<number>(0);
  const rootElRef = useRef<HTMLDivElement>(null);

  // Comp's componentDidMount cycle: dwell 3200ms on a panel, 1500ms dark gap,
  // then advance. Drives the scan-line glow on the three hero mock panels.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const DWELL = 3200, GAP = 1500;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = () => {
      timer = setTimeout(() => {
        setFocusStep(-1);
        timer = setTimeout(() => {
          idx = (idx + 1) % 3;
          setFocusStep(idx);
          cycle();
        }, GAP);
      }, DWELL);
    };
    cycle();
    return () => clearTimeout(timer);
  }, []);

  // Comp's scroll-reveal: .gv-r rises, .gv-r-left slides in from the left,
  // .gv-card fades. Siblings stagger 60ms up to 6 deep.
  useEffect(() => {
    const root = rootElRef.current;
    if (!root) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.gv-r, .gv-card, .gv-r-left'));
    if (reduce || !targets.length) return;

    const seen = new Map<Element | null, number>();
    const delays = new Map<HTMLElement, number>();
    targets.forEach((node) => {
      const p = node.parentElement;
      const c = seen.get(p) || 0;
      delays.set(node, Math.min(c, 6) * 60);
      seen.set(p, c + 1);
      node.style.opacity = '0';
    });

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const reveal = (node: HTMLElement) => {
      const delay = delays.get(node) ?? 0;
      const name = node.classList.contains('gv-card')
        ? 'gvFade'
        : node.classList.contains('gv-r-left') ? 'gvRiseLeft' : 'gvRise';
      node.style.animation = `${name} .7s cubic-bezier(.22,.61,.36,1) ${delay}ms both`;
      timeouts.push(setTimeout(() => { node.style.animation = ''; node.style.opacity = ''; }, delay + 800));
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          reveal(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach((node) => io.observe(node));

    return () => { io.disconnect(); timeouts.forEach(clearTimeout); };
  }, []);

  const clean = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/$/, '').trim().toLowerCase();
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const host = clean(domain);
    router.push(host.includes('.') ? `/signup?domain=${encodeURIComponent(host)}` : '/signup');
  };

  const startHref = loggedIn ? '/dashboard' : '/signup';
  const isMonthly = billing === 'monthly';

  /* ── focus-glow tokens (comp renderVals) ── */
  const normalBorder = '1px solid rgba(255,255,255,0.08)';
  const normalBg = '#111110';
  const glowBg = `${ACCENT}14`;
  const spinAnim = 'gvScanMove 4s ease-in-out infinite';
  const scanGradient = `linear-gradient(180deg, transparent, ${ACCENT}1a 35%, ${ACCENT}26 50%, ${ACCENT}1a 65%, transparent)`;
  const glowBoxShadow = `0 0 0 1.5px ${ACCENT}99, 0 0 22px ${ACCENT}40`;
  const bgTransition = 'background-color .6s ease';
  const glowTransition = 'opacity 1.4s ease, background-color 1.4s ease';

  const scanLayer = (on: boolean) => (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 12, overflow: 'hidden', pointerEvents: 'none', boxShadow: glowBoxShadow, opacity: on ? 1 : 0, transition: glowTransition }}>
      <div style={{ position: 'absolute', left: 0, right: 0, height: '90%', background: scanGradient, filter: 'blur(10px)', animation: spinAnim }} />
    </div>
  );

  /* ── hero dashboard mock data ── */
  const dashStats = [
    // Illustrative dashboard, not a results claim — deltas stay in the range a
    // real account actually posts. The comp's "+460%" read as a promise.
    { label: 'Search clicks', big: '812', delta: '+12%', sub: '61 reads this week', pos: true },
    { label: 'Posts published', big: '34', delta: '+6', sub: '3 a week, on schedule', pos: true },
    { label: 'In pipeline', big: '3', delta: '', sub: 'being researched now', pos: false },
    { label: 'Awaiting review', big: '1', delta: '', sub: 'one draft needs a look', pos: false },
  ];
  const calDaysRaw: { d: number | ''; pad?: boolean; post?: boolean }[] = [
    { d: '', pad: true }, { d: '', pad: true }, { d: '', pad: true },
    { d: 1 }, { d: 2 }, { d: 3 }, { d: 4 },
    { d: 5 }, { d: 6 }, { d: 7, post: true }, { d: 8, post: true }, { d: 9 }, { d: 10, post: true }, { d: 11 },
    { d: 12 }, { d: 13 }, { d: 14, post: true }, { d: 15 }, { d: 16 }, { d: 17 }, { d: 18 },
    { d: 19 }, { d: 20 }, { d: 21 }, { d: 22 }, { d: 23 }, { d: 24 }, { d: 25 },
    { d: 26 }, { d: 27 }, { d: 28 }, { d: 29 }, { d: 30 }, { d: 31 }, { d: '', pad: true },
  ];
  const pipeline = [
    { title: 'The Complete Guide to AI Onboarding Checklists', keyword: 'ai onboarding checklist', status: 'Live', pos: true },
    { title: '7 Content Brief Generators Compared for 2026', keyword: 'content brief generator', status: 'Live', pos: true },
    { title: 'How Founders Are Automating Their Blog in 2026', keyword: 'automate blog content', status: 'Scheduled', pos: false },
  ];
  const embedPosts = [
    { date: 'Jul 11, 2026', title: 'How to Make a 3D Logo in Illustrator (And the 6-Second Alternative)' },
    { date: 'Jul 11, 2026', title: 'Venngage AI 3D Icon Generator vs Grove: Which Builds Better UI Assets?' },
    { date: 'Jul 10, 2026', title: 'How to Make Drop-In Ready Assets in 60 Seconds With an AI 3D Icon Maker' },
  ];

  // Real publish surfaces only — grove has no WordPress/Webflow/Ghost plugin,
  // and the comp's logo row listed CMSes we don't integrate with.
  const platforms = ['Hosted blog', 'One-line embed', 'Webhook', 'Zapier / n8n', 'RSS', 'JSON API'];
  // Product facts, not invented social proof (the comp had "+312% growth",
  // "2,400+ posts", "4.9★" — none of which we can stand behind).
  const stats = [
    { big: '4 checks', label: 'every draft is scored on strategy, marketing, craft and safety' },
    { big: '0–100', label: 'a post has to earn its score before it can publish' },
    { big: '1 line', label: 'of code to run the whole blog on your own site' },
    { big: '0', label: 'third-party trackers — your reader data stays yours' },
  ];

  const pillars = [
    { name: 'AI 3D icon generation', pct: '46%', count: 6, color: '#d7d9d3' },
    { name: 'Automatic background removal', pct: '38%', count: 5, color: '#7fb6e6' },
    { name: 'Shipping brand-consistent assets', pct: '16%', count: 2, color: '#c9a3e6' },
  ];
  const weekRows = [
    { tag: 'MOFU', tagColor: '#e0c878', tagBg: 'rgba(224,200,120,0.08)', tagBorder: 'rgba(224,200,120,0.28)', title: 'The 7 best AI 3D icon generators in 2026, tested honestly', status: 'Live' },
    { tag: 'BOFU', tagColor: '#c9a3e6', tagBg: 'rgba(201,163,230,0.08)', tagBorder: 'rgba(201,163,230,0.28)', title: 'Pixelcut’s AI 3D icon generator vs Grove: which ships to production', status: 'Live' },
    { tag: 'MOFU', tagColor: '#e0c878', tagBg: 'rgba(224,200,120,0.08)', tagBorder: 'rgba(224,200,120,0.28)', title: 'Is there a truly free AI 3D icon generator? What you get at $0', status: 'Live' },
  ];
  const pipelineRows = [
    { title: 'Finding the Best Auto Background Remover App: 7 Top Picks for 2026', date: 'Wed, Jul 15', reads: 4, score: '81', scoreColor: '#8fce9a' },
    { title: 'The Best Automatic Background Remover in 2026: 8 Tools Tested', date: 'Tue, Jul 14', reads: 0, score: '65', scoreColor: '#e0c878' },
    { title: 'Venngage AI 3D Icon Generator vs Grove: Which Builds Better Assets?', date: 'Sat, Jul 11', reads: 0, score: '84', scoreColor: '#8fce9a' },
  ];
  const analyticsNums = [
    { big: '77', label: 'Organic clicks', delta: '-12%', deltaColor: '#c17b6b' },
    { big: '1.6k', label: 'Impressions', delta: '+16%', deltaColor: ACCENT },
    { big: '4.9%', label: 'Avg. CTR', delta: '-1.5pt', deltaColor: '#c17b6b' },
    { big: '10.9', label: 'Avg. position', delta: '-1.0', deltaColor: '#c17b6b' },
  ];
  const trafficSources = [
    { name: 'Google Search', pct: '76%', color: ACCENT },
    { name: 'Answer engines', pct: '0%', color: '#7fb6e6' },
    { name: 'Direct', pct: '16%', color: '#565952' },
    { name: 'Social + referral', pct: '8%', color: '#3a3b36' },
  ];

  // Pricing renders straight from the plan catalogue so this page can never
  // disagree with /dashboard/billing.
  const tiers = (['starter', 'growth', 'agency'] as const).map((id) => ({
    name: PLANS[id].name,
    blurb: PLANS[id].blurb,
    popular: id === 'growth',
    cta: 'Start free',
    feats: PLANS[id].features,
    price: monthlyPriceUsd(id, isMonthly ? 'month' : 'year'),
    note: isMonthly ? 'billed monthly' : `/mo — $${formatUsd(yearlyPriceUsd(id))} billed annually`,
  }));

  const faqs = [
    { q: 'Do I need WordPress or any hosting?', a: 'No. Grove hosts the blog for you at no extra cost. If you would rather it live on your own site, one script tag renders it inside anything — WordPress, Webflow, Framer, Shopify, Next.js. A publish webhook can also push every post into Zapier, Make or n8n.' },
    { q: 'Will the posts actually sound like me?', a: 'Grove reads the posts you have already written and drafts to match them. When something is off, correct it once and the correction carries into every draft after. Expect to steer the first few; after that it needs much less.' },
    { q: 'Isn’t AI content bad for SEO now?', a: 'Thin, generic AI content is. Grove researches what already ranks for each keyword before it writes, and cites real sources — the goal is a page that deserves to rank, not more pages.' },
    { q: 'Can I review posts before they go live?', a: 'Always. Approve every post yourself, or let Grove publish on its own once you trust it. You set this per site and can change it any time.' },
    { q: 'What’s the catch with the subscription?', a: 'None. Cancel any time and keep everything published — the posts are on your domain and they stay yours. No long contracts, no per-seat pricing.' },
    { q: 'How fast is the first post?', a: 'Add your domain, verify you own it, and Grove starts researching straight away. The first draft usually lands in your queue within a few minutes, in the same sitting.' },
  ];

  const footcols = [
    { head: 'Product', links: [['Agents', '#agents'], ['Platform', '#platform'], ['Pricing', '#pricing'], ['Blog', '/blog'], ['FAQ', '#faq']] },
    { head: 'Legal', links: [['Privacy', '/privacy'], ['Terms', '/terms']] },
  ];

  const eyebrow = { fontSize: 12, letterSpacing: '0.14em', color: '#7c7f77', textTransform: 'uppercase' as const, marginBottom: 16 };
  const h2Style = { fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '0 0 16px', color: '#f7f7f5', fontFamily: "'GT Walsheim', 'Inter', sans-serif" };
  const leadStyle = { fontSize: 18, fontWeight: 400, color: '#9a9d97', lineHeight: 1.6, margin: 0 };
  const cardBase = { background: '#0a0a09', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, padding: 26, boxSizing: 'border-box' as const, width: 278, flexShrink: 0, height: 340, display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between' };
  // Shared sizing for every real CTA/UI button (nav, hero, pricing, FAQ, final
  // form) — excludes controls inside the demo dashboard/agent-chat mockups,
  // which mirror the product UI and keep their own sizing.
  const ctaBtn = { height: 32, boxSizing: 'border-box' as const, display: 'inline-flex', alignItems: 'center' as const, justifyContent: 'center' as const, fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontWeight: 500, fontSize: 14 };
  return (
    <div className="gv-land" ref={rootElRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* NAV — components/SiteNav.tsx is the single definition; /blog and the
          hosted blog render the same bar. Editing the links here instead is
          what left /blog without a FAQ item. */}
      <SiteNav
        onLanding
        position="fixed"
        brandHref="#hero"
        ctaHref={startHref}
        ctaLabel={loggedIn ? 'Dashboard' : 'Get Started'}
      />

      {/* HERO */}
      <section id="hero" style={{ padding: '152px 24px 0', maxWidth: 1200, margin: '0 auto', textAlign: 'left', width: '100%' }}>
        <div className="gv-r">
          <h1 style={{ fontSize: 'clamp(34px, 5.2vw, 54px)', lineHeight: 1.08, fontWeight: 500, letterSpacing: '-0.03em', margin: '0 0 20px', color: '#f7f7f5', display: 'inline-block', fontFamily: "'GT Walsheim', 'Inter', sans-serif" }}>
            Plant your domain<br />and watch your traffic grow.
          </h1>
          <p style={{ fontSize: 18, fontWeight: 400, lineHeight: 1.6, color: '#9a9d97', maxWidth: 540, margin: '0 0 30px' }}>
            Connect your domain. Grove finds what your customers are searching for, writes the posts, and publishes them on your site — under your name, on a schedule you set.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 56 }}>
            <a className="gv-btn" href={startHref} style={{ ...ctaBtn, background: '#f4f4f2', color: '#0a0a0a', padding: '0 24px', borderRadius: 8, textDecoration: 'none' }}>{loggedIn ? 'Open dashboard' : 'Get started'}</a>
            <a className="gv-btn gv-ghost" href="#agents" style={{ ...ctaBtn, border: '1px solid rgba(255,255,255,0.18)', color: '#f4f4f2', padding: '0 24px', borderRadius: 8, textDecoration: 'none', backgroundColor: '#111110' }}>See how it works</a>
          </div>
        </div>

        {/* DASHBOARD MOCKUP */}
        <div className="gv-r" style={{ width: '100%', margin: '0 auto', background: '#000', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, boxShadow: '0 50px 110px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {/* SIDEBAR */}
            <div className="gv-mockside" style={{ flex: '0 0 190px', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 20, backgroundColor: '#070707' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: '#f4f4f2' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 5, background: '#111110', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src="/landing/grove-mark.png" alt="" style={{ width: 10, height: 10, objectFit: 'contain' }} />
                  </span>grove
                </span>
                <span style={{ fontSize: 8.5, letterSpacing: '0.06em', color: ACCENT, border: '1px solid rgba(162,255,1,0.35)', borderRadius: 5, padding: '2px 6px' }}>STARTER</span>
              </div>
              {[
                { head: 'Create', items: ['Home', 'Strategy', 'Write', 'Pipeline'] },
                { head: 'Publish', items: ['Calendar', 'Analytics'] },
                { head: 'Brand', items: ['Brand voice', 'Social', 'Embed'] },
              ].map((sec) => (
                <div key={sec.head}>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565952', margin: '0 6px 6px' }}>{sec.head}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {sec.items.map((it) => {
                      const active = it === 'Home';
                      return (
                        <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: active ? 600 : 400, color: active ? '#f4f4f2' : '#9a9d97', background: active ? 'rgba(162,255,1,0.1)' : undefined, borderRadius: active ? 7 : undefined, padding: '7px 8px' }}>{it}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(162,255,1,0.15)', color: ACCENT, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>W</span>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#f4f4f2' }}>www.oveners.com</div>
                  <div style={{ fontSize: 9, color: '#6b6e68' }}>manage site</div>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, backgroundColor: '#070707' }}>
              {/* stat cards */}
              <div className="gv-dashstats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {dashStats.map((st, i) => {
                  const active = i === 0 && focusStep === 0;
                  return (
                    <div key={st.label} style={{ position: 'relative', background: active ? glowBg : normalBg, border: normalBorder, transition: bgTransition, borderRadius: 12, padding: '13px 14px' }}>
                      {scanLayer(active)}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7c7f77', marginBottom: 10 }}>{st.label}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                        <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: '#f4f4f2' }}>{st.big}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: st.pos ? ACCENT : '#6b6e68' }}>{st.delta}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: '#5b5e56', marginTop: 4 }}>{st.sub}</div>
                    </div>
                  );
                })}
              </div>

              {/* calendar + agent panel */}
              <div className="gv-dashsplit" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 12, alignItems: 'start' }}>
                <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f2' }}>Publishing calendar</div>
                      <div style={{ fontSize: 10.5, color: '#6b6e68' }}>When each post goes live</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#7c7f77', fontWeight: 600 }}>July 2026</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px 4px', fontSize: 9.5, color: '#565952', textAlign: 'center', marginBottom: 4 }}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {calDaysRaw.map((cd, i) => (
                      <div key={i} style={{ aspectRatio: '1', borderRadius: 7, background: cd.pad ? 'transparent' : '#0c0c0c', border: '1px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 10.5, color: cd.pad ? 'transparent' : '#c9cbc5' }}>
                        {cd.d}
                        {cd.post && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#6b6e68' }} />}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ position: 'relative', background: focusStep === 1 ? glowBg : normalBg, border: normalBorder, transition: bgTransition, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ position: 'relative', zIndex: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT, animation: 'gvPulse 1.8s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#f4f4f2' }}>Your marketing agent</span>
                  </div>
                  <p style={{ position: 'relative', zIndex: 0, fontSize: 11.5, lineHeight: 1.5, color: '#9a9d97', margin: 0 }}>Published 4 articles this week. Reads are up on last month.</p>
                  <div style={{ position: 'relative', zIndex: 0, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565952', marginTop: 2 }}>Working on now</div>
                  <div style={{ position: 'relative', zIndex: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#c9cbc5', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 10px' }}>
                    <span style={{ color: '#6b6e68' }}>✓</span> All caught up — no drafts to review
                  </div>
                  <div style={{ position: 'relative', zIndex: 0, fontSize: 11, lineHeight: 1.5, color: '#9a9d97', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 11px' }}>
                    &ldquo;3D icon generator roundup&rdquo; is your best post this month. Want me to write three more around it?
                  </div>
                  <button style={{ position: 'relative', zIndex: 0, alignSelf: 'flex-start', color: '#0a0a08', fontFamily: 'inherit', fontWeight: 700, fontSize: 11.5, padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', backgroundColor: ACCENT }}>Review plan</button>
                  <div style={{ position: 'absolute', inset: 0, zIndex: 1, borderRadius: 12, overflow: 'hidden', pointerEvents: 'none', boxShadow: glowBoxShadow, opacity: focusStep === 1 ? 1 : 0, transition: glowTransition }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, height: '90%', background: scanGradient, filter: 'blur(10px)', animation: spinAnim }} />
                  </div>
                </div>
              </div>

              {/* pipeline table */}
              <div style={{ position: 'relative', background: focusStep === 2 ? glowBg : normalBg, border: normalBorder, transition: bgTransition, borderRadius: 12, padding: '14px 16px' }}>
                {scanLayer(focusStep === 2)}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f2' }}>Content pipeline</div>
                  <div style={{ fontSize: 10.5, color: '#6b6e68' }}>View all →</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 0.6fr', gap: 8, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#565952', padding: '0 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Post</span><span>Target keyword</span><span>Status</span>
                </div>
                {pipeline.map((row) => (
                  <div className="gv-row" key={row.title} style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 0.6fr', gap: 8, alignItems: 'center', padding: 10, borderRadius: 8, fontSize: 12 }}>
                    <span style={{ color: '#d7d9d3' }}>{row.title}</span>
                    <span style={{ color: '#7c7f77' }}>{row.keyword}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#9a9d97' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: row.pos ? '#7fd88a' : '#7c7f77' }} />{row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3-step setup */}
        <div className="gv-steps3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '16px 0 20px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          {[
            { n: '01', t: 'Plant your domain', s: 'One field. Nothing to install.' },
            { n: '02', t: 'Verify you own it', s: 'DNS or meta tag · 2 min' },
            { n: '03', t: 'Approve, or let it run', s: 'Your call, changeable any time' },
          ].map((st) => (
            <div key={st.n} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF', border: '1px solid #FFFFFF59', borderRadius: 6, padding: '3px 7px', flexShrink: 0 }}>{st.n}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f4f4f2', marginBottom: 2 }}>{st.t}</div>
                <div style={{ fontSize: 11, color: '#7c7f77' }}>{st.s}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* EMBED WIDGET */}
      <section id="embed" style={{ padding: '220px 24px 90px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="gv-r" style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 44px' }}>
          <div style={eyebrow}>Embed anywhere</div>
          <h2 style={h2Style}>One line of code.<br />The blog lives on your site.</h2>
          <p style={leadStyle}>Paste one script tag and your newest posts appear on your own domain — updating themselves every time Grove publishes. No rebuild, no CMS to wire up.</p>
        </div>

        {/* marquee row 1 (left) */}
        <div className="gv-r" style={{ width: '100%', overflow: 'hidden', borderRadius: 18, height: 340 }}>
          <div style={{ display: 'flex', gap: 14, width: 'max-content', height: 340, animation: 'gvMarqueeL 70s linear infinite' }}>
            {[0, 1].map((dup) => (
              <div key={dup} style={{ display: 'flex', gap: 14 }}>
                <div style={{ width: 590, flexShrink: 0, borderRadius: 18, overflow: 'hidden', background: 'url("/landing/blog-cards-hero.png") center / cover no-repeat', height: 340 }} />

                <div style={{ ...cardBase, padding: 0, overflow: 'hidden', justifyContent: 'flex-start', gap: 29 }}>
                  <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FFF', opacity: 0.6 }}>Embed snippet</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f4f4f2', lineHeight: 1.3 }}>Turn homepage visitors into readers</div>
                  </div>
                  <div style={{ position: 'relative', flex: 1, margin: '0 18px 18px', background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 0 0 18px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 18, marginBottom: 12 }}>
                      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7c7f77' }}>Blog</span>
                      <span style={{ fontSize: 10.5, color: '#9a9d97' }}>Read the blog →</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {embedPosts.map((ep) => (
                        <div key={ep.title} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                          <div style={{ width: 42, height: 32, flexShrink: 0, border: '1px dashed rgba(255,255,255,0.28)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5.5-5.5L9 17" /></svg>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 9.5, color: '#6b6e68', marginBottom: 3 }}>{ep.date}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#eef0ea', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{ep.title}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, background: 'linear-gradient(180deg, rgba(17,17,16,0), #111110d9, #111110)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 70, background: 'linear-gradient(90deg, rgba(17,17,16,0), #111110)', pointerEvents: 'none' }} />
                  </div>
                </div>

                <div style={{ ...cardBase, background: ACCENT, border: 'none', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0a0a08', opacity: 0.6 }}>Embed snippet</div>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: '#0a0a08', lineHeight: 1.3 }}>Paste it once.<br />Never touch it again.</div>
                  </div>
                  <div style={{ background: 'rgba(10,10,8,0.9)', borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      <span style={{ color: 'rgb(107,122,143)' }}>&lt;</span><span style={{ color: 'rgb(232,163,208)' }}>div</span> <span style={{ color: 'rgb(159,207,143)' }}>id</span><span style={{ color: 'rgb(107,122,143)' }}>=</span><span style={{ color: 'rgb(224,193,132)' }}>&quot;grove-widget&quot;</span> <span style={{ color: 'rgb(159,207,143)' }}>data-blog-url</span><span style={{ color: 'rgb(107,122,143)' }}>=</span><span style={{ color: 'rgb(224,193,132)' }}>&quot;/blog&quot;</span><span style={{ color: 'rgb(107,122,143)' }}>&gt;{'\n'}&lt;/</span><span style={{ color: 'rgb(232,163,208)' }}>div</span><span style={{ color: 'rgb(107,122,143)' }}>&gt;{'\n'}&lt;</span><span style={{ color: 'rgb(232,163,208)' }}>script</span> <span style={{ color: 'rgb(159,207,143)' }}>src</span><span style={{ color: 'rgb(107,122,143)' }}>=</span><span style={{ color: 'rgb(224,193,132)' }}>&quot;https://trygroveai.com/embed.js&quot;</span> <span style={{ color: 'rgb(159,207,143)' }}>async</span><span style={{ color: 'rgb(107,122,143)' }}>&gt;&lt;/</span><span style={{ color: 'rgb(232,163,208)' }}>script</span><span style={{ color: 'rgb(107,122,143)' }}>&gt;</span>
                    </div>
                  </div>
                </div>

                <div style={cardBase}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT }}>Consistent voice</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f4f4f2', marginBottom: 8, lineHeight: 1.3 }}>Sounds like you, everywhere</div>
                    <div style={{ fontSize: 11.5, color: '#8a8d86', lineHeight: 1.55 }}>Grove reads your site first — what you sell, who you sell to, how you write — before it drafts a word.</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* marquee row 2 (right) */}
        <div className="gv-r" style={{ width: '100%', overflow: 'hidden', borderRadius: 18, height: 340, marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 14, width: 'max-content', height: 340, animation: 'gvMarqueeR 78s linear infinite' }}>
            {[0, 1].map((dup) => (
              <div key={dup} style={{ display: 'flex', gap: 14 }}>
                <div style={{ ...cardBase, justifyContent: 'flex-start', overflow: 'hidden' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT, marginBottom: 10 }}>Auto-posting</div>
                  <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35, marginBottom: 8 }}>Posts to X and<br />LinkedIn for you</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 60, position: 'relative' }}>
                    <span style={{ width: 69, height: 69, borderRadius: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT }}>
                      <img src="/landing/grove-glyph.svg" alt="" style={{ width: 53, height: 53, objectFit: 'contain' }} />
                    </span>
                    <span style={{ position: 'relative', width: 32, height: 42, flexShrink: 0 }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <span style={{ width: 69, height: 69, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.14)', fontWeight: 700, fontSize: 24, color: '#f4f4f2' }}>X</span>
                      <span style={{ width: 69, height: 69, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0A66C2', fontWeight: 700, fontSize: 24, color: '#fff' }}>in</span>
                    </span>
                    <svg viewBox="0 0 32 42" style={{ position: 'absolute', overflow: 'visible', width: 33, height: 107, left: 94, top: 20 }}>
                      <path d="M0 21 C 14 21, 14 5, 27 5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
                      <path d="M0 21 C 14 21, 14 37, 27 37" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
                      <path d="M22 1 L28 5 L22 9" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
                      <path d="M22 33 L28 37 L22 41" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
                    </svg>
                  </div>
                </div>

                <div style={{ width: 278, flexShrink: 0, height: 340, borderRadius: 18, background: 'url("/landing/editor.png") center / cover no-repeat' }} />

                <img src="/landing/blog-cards.png" alt="" style={{ width: 569, flexShrink: 0, objectFit: 'cover', borderRadius: 18, height: 340 }} />

                <div style={cardBase}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT }}>Zero upkeep</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f4f4f2', marginBottom: 8, lineHeight: 1.3 }}>Set it once, forget it</div>
                    <div style={{ fontSize: 11.5, color: '#8a8d86', lineHeight: 1.55 }}>Nothing to babysit. Every new post reaches your site, your blog and your social accounts on its own.</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LOGO ROW */}
      <section style={{ padding: '66px 24px 60px', textAlign: 'center', backgroundColor: '#000' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#565952', textTransform: 'uppercase', marginBottom: 24 }}>Where your posts can go</div>
        <div className="gv-r" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '36px 52px' }}>
          {platforms.map((p) => (
            <span key={p} style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: '#565952' }}>{p}</span>
          ))}
        </div>
      </section>

      {/* STATS STRIP */}
      <section style={{ padding: '0 24px 120px', backgroundColor: '#000' }}>
        <div className="gv-r gv-statstrip" style={{ maxWidth: 1120, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {stats.map((s) => (
            <div key={s.big} style={{ textAlign: 'center', padding: '44px 16px' }}>
              <div style={{ fontSize: 'clamp(26px, 3.4vw, 38px)', fontWeight: 500, letterSpacing: '-0.03em', color: '#f4f4f2' }}>{s.big}</div>
              <div style={{ fontSize: 12, color: '#7c7f77', marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* AGENTS */}
      <section id="agents" style={{ padding: '30px 24px 120px', maxWidth: 1120, margin: '0 auto', backgroundColor: '#000' }}>
        <div className="gv-r-left" style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 60px' }}>
          <div style={eyebrow}>Meet the agents</div>
          <h2 style={h2Style}>Three agents.<br />One growing blog.</h2>
          <p style={leadStyle}>Each one does a job you&rsquo;d otherwise hire for, and hands the work to the next without being asked.</p>
        </div>

        {/* STRATEGY */}
        <div className="gv-r-left" style={{ marginBottom: 26, borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', padding: 26, backgroundColor: '#000' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
              <div style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', background: '#0a0b0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '22px 0 0 24px', minHeight: 540, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingRight: 24 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#f4f4f2' }}>Strategy</div>
                    <div style={{ fontSize: 11.5, color: '#565952', marginTop: 1 }}>www.oveners.com · the monthly plan your agent works from</div>
                  </div>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#d7d9d3', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d7d9d3' }} />Autopilot on
                  </span>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1a1a18', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: '#d7d9d3', flexShrink: 0 }}>TY</span>
                </div>

                <div className="gv-strategysplit" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, margin: '0 24px 14px 0' }}>
                  <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: '#eef0ea' }}>Topical authority map</div>
                    <div style={{ fontSize: 10.5, color: '#6b6e68', margin: '2px 0 12px' }}>Hub-and-spoke clusters — own a topic, not just a keyword</div>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                      {[['Published', '#d7d9d3'], ['Planned', '#7fb6e6'], ['Gap', '#565952']].map(([n, c]) => (
                        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#9a9d97' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />{n}
                        </span>
                      ))}
                    </div>
                    <svg viewBox="0 0 220 168" style={{ width: '100%', height: 148, display: 'block' }}>
                      <g stroke="rgba(255,255,255,0.14)" strokeWidth="1">
                        <line x1="110" y1="84" x2="110" y2="20" /><line x1="110" y1="84" x2="168" y2="52" /><line x1="110" y1="84" x2="168" y2="116" />
                        <line x1="110" y1="84" x2="110" y2="150" /><line x1="110" y1="84" x2="52" y2="116" /><line x1="110" y1="84" x2="52" y2="52" />
                      </g>
                      <circle cx="110" cy="84" r="21" fill="#111110" stroke="rgba(255,255,255,0.18)" />
                      <text x="110" y="87" textAnchor="middle" fill="#c9cbc5" fontSize="8" fontWeight="700">HUB</text>
                      <circle cx="110" cy="20" r="6" fill="#d7d9d3" /><circle cx="168" cy="52" r="6" fill="#d7d9d3" />
                      <circle cx="168" cy="116" r="6" fill="#7fb6e6" /><circle cx="110" cy="150" r="6" fill="#d7d9d3" />
                      <circle cx="52" cy="116" r="6" fill="#d7d9d3" /><circle cx="52" cy="52" r="6" fill="#565952" stroke="#7c7f77" strokeDasharray="2 2" />
                    </svg>
                    <div style={{ fontSize: 10.5, color: '#6b6e68', marginTop: 10 }}>6 of 6 spokes covered · 0 gaps worth filling</div>
                  </div>

                  <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: '#eef0ea' }}>Content pillars</div>
                    <div style={{ fontSize: 10.5, color: '#6b6e68', margin: '2px 0 12px' }}>How July&rsquo;s effort is allocated</div>
                    <div style={{ display: 'flex', height: 7, borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
                      {pillars.map((pl) => <div key={pl.name} style={{ height: '100%', width: pl.pct, background: pl.color }} />)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {pillars.map((pl) => (
                        <div key={pl.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: pl.color, marginTop: 4, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#d7d9d3', lineHeight: 1.3 }}>{pl.name}</div>
                            <div style={{ fontSize: 10.5, color: '#6b6e68', marginTop: 2 }}>{pl.count} posts planned</div>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#eef0ea', whiteSpace: 'nowrap' }}>{pl.pct}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px', margin: '0 24px 0 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#eef0ea' }}>The month, week by week</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6b6e68' }}>13 posts · July 2026</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {weekRows.map((wk) => (
                      <div key={wk.title} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: wk.tagColor, background: wk.tagBg, border: `1px solid ${wk.tagBorder}`, borderRadius: 6, padding: '3px 8px', flexShrink: 0 }}>{wk.tag}</span>
                        <span style={{ fontSize: 12.5, color: '#c9cbc5', flex: 1, minWidth: 0 }}>{wk.title}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9d97', flexShrink: 0 }}>{wk.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100, background: 'linear-gradient(to bottom, rgba(10,11,10,0), #0a0b0a 88%)', pointerEvents: 'none' }} />
              </div>

              <div className="gv-chatpanel" style={{ flex: '0 0 240px', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 540 }}>
                <div style={{ background: '#141412', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '11px 12px' }}>
                  <div style={{ fontSize: 11, lineHeight: 1.5, color: '#c9cbc5' }}><span style={{ color: '#f4f4f2', fontWeight: 700 }}>/strategy</span> Build my July plan around AI 3D icon tools.</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: '#6b6e68', marginBottom: 6 }}>Thought · 6s</div>
                  <p style={{ fontSize: 11.5, lineHeight: 1.55, color: '#9a9d97', margin: 0 }}>I&rsquo;ll map topical authority, allocate the content pillars, and lay out the month week by week.</p>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f2' }}>Changes</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b6e68' }}>Undo</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 10px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#d7d9d3', flexShrink: 0 }}>◎</span>
                    <span style={{ fontSize: 11.5, color: '#d7d9d3', flex: 1 }}>Strategy</span>
                    <span style={{ fontSize: 10.5, color: '#6b6e68' }}>13 posts</span>
                  </div>
                </div>
                <div style={{ marginTop: 'auto', fontSize: 11, color: '#55564f', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 999, padding: '9px 13px' }}>Add follow up…</div>
              </div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -26, height: 300, background: 'linear-gradient(180deg, #07070700, #000000B3, #000000)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: -26, bottom: -26, right: -26, width: 300, background: 'linear-gradient(90deg, rgba(11,11,11,0), #000000)', pointerEvents: 'none' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, paddingTop: 24 }}>
            <div style={{ maxWidth: 480 }}>
              <div style={{ fontSize: 12, color: '#7c7f77', textTransform: 'uppercase', marginBottom: 10 }}>Strategy agent</div>
              <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1, color: '#f4f4f2', marginBottom: 12 }}>Decides what to write next</div>
              <p style={leadStyle}>Grove checks what already ranks for your keywords, compares it to what you&rsquo;ve published, and turns the gaps into a dated plan for the month.</p>
            </div>
            <a className="gv-navlink gv-accentlink" href={startHref} style={{ color: '#d7d9d3', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>Explore the Strategy agent →</a>
          </div>
        </div>

        {/* WRITE */}
        <div className="gv-r-left" style={{ marginBottom: 26, borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', padding: 26, backgroundColor: '#000' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', background: '#0a0b0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '22px 0 0 24px', minHeight: 440, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, paddingRight: 24 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#f4f4f2' }}>Content pipeline</div>
                    <div style={{ fontSize: 11.5, color: '#565952', marginTop: 1 }}>www.oveners.com · the agent loop, running live</div>
                  </div>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#d7d9d3', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d7d9d3' }} />Autopilot on
                  </span>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1a1a18', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: '#d7d9d3', flexShrink: 0 }}>TY</span>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, margin: '0 24px 12px 0' }}>
                  <span style={{ flex: 1, fontSize: 12, color: '#55564f' }}>Add a topic… e.g. &ldquo;reduce churn with onboarding nudges&rdquo;</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: '#d7d9d3', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '7px 12px', whiteSpace: 'nowrap' }}>✦ Suggest</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0a0a08', background: ACCENT, borderRadius: 8, padding: '7px 12px', whiteSpace: 'nowrap' }}>Queue topic</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 16px', margin: '0 24px 16px 0' }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#7c7f77' }}>PUBLISHING</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6b6e68' }}>Manual</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0a0a08', background: '#d7d9d3', borderRadius: 999, padding: '5px 12px' }}>Auto</span>
                  <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)' }} />
                  <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#7c7f77' }}>CADENCE</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0a0a08', background: '#d7d9d3', borderRadius: 6, padding: '4px 9px' }}>3</span>
                  <span style={{ fontSize: 11, color: '#6b6e68' }}>/ week</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6b6e68', whiteSpace: 'nowrap' }}>Posts publish automatically on schedule</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 24px 10px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d7d9d3' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: '#d7d9d3' }}>PUBLISHED</span>
                  <span style={{ fontSize: 11, color: '#6b6e68' }}>30</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 24px 0 0' }}>
                  {pipelineRows.map((pr) => (
                    <div key={pr.title} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#9a9d97', flexShrink: 0 }}>◐</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eef0ea', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</div>
                        <div style={{ fontSize: 10.5, color: '#6b6e68', marginTop: 2 }}>Live · {pr.date} · {pr.reads} reads</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: pr.scoreColor, whiteSpace: 'nowrap' }}>{pr.score} <span style={{ fontSize: 9, color: '#565952', fontWeight: 600 }}>SCORE</span></span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9d97', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '6px 10px', whiteSpace: 'nowrap' }}>Regenerate</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9d97', whiteSpace: 'nowrap' }}>View ↗</span>
                    </div>
                  ))}
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100, background: 'linear-gradient(to bottom, rgba(10,11,10,0), #0a0b0a 88%)', pointerEvents: 'none' }} />
              </div>

              <div className="gv-chatpanel" style={{ flex: '0 0 240px', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: '#141412', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '11px 12px' }}>
                  <div style={{ fontSize: 11, lineHeight: 1.5, color: '#c9cbc5' }}><span style={{ color: '#f4f4f2', fontWeight: 700 }}>/write</span> Queue this week&rsquo;s onboarding post and publish it on schedule.</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: '#6b6e68', marginBottom: 6 }}>Thought · 4s</div>
                  <p style={{ fontSize: 11.5, lineHeight: 1.55, color: '#9a9d97', margin: 0 }}>I&rsquo;ll draft the post in your voice, score it against the publish bar, and schedule it with the rest of the queue.</p>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f2' }}>Changes</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b6e68' }}>Undo</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 10px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#d7d9d3', flexShrink: 0 }}>◐</span>
                    <span style={{ fontSize: 11.5, color: '#d7d9d3', flex: 1 }}>Pipeline</span>
                    <span style={{ fontSize: 10.5, color: '#6b6e68' }}>1 queued</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#55564f', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 999, padding: '9px 13px' }}>Add follow up…</div>
              </div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -26, height: 300, background: 'linear-gradient(180deg, rgba(11,11,11,0), #000000B3, #000000)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: -26, bottom: -26, right: -26, width: 300, background: 'linear-gradient(90deg, #00000000, #000000)', pointerEvents: 'none' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, paddingTop: 24 }}>
            <div style={{ maxWidth: 480 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', color: '#7c7f77', textTransform: 'uppercase', marginBottom: 10 }}>Write agent</div>
              <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1, color: '#f4f4f2', marginBottom: 12 }}>Writes full drafts in your voice</div>
              <p style={leadStyle}>Grove learns from the posts you already have, then writes finished articles with real sources — and shows you where it matched your voice.</p>
            </div>
            <a className="gv-navlink gv-accentlink" href={startHref} style={{ color: '#d7d9d3', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>Explore the Write agent →</a>
          </div>
        </div>

        {/* ANALYTICS */}
        <div className="gv-r-left" style={{ borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', padding: 26, backgroundColor: '#000' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', background: '#0a0b0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '22px 0 0 24px', minHeight: 440, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, paddingRight: 24 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#f4f4f2' }}>Analytics</div>
                    <div style={{ fontSize: 11.5, color: '#565952', marginTop: 1 }}>www.oveners.com · how the blog is compounding</div>
                  </div>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 500, color: '#d7d9d3', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d7d9d3' }} />Autopilot on
                  </span>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1a1a18', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: '#d7d9d3', flexShrink: 0 }}>TY</span>
                </div>

                <div style={{ fontSize: 20, fontWeight: 500, color: '#f4f4f2', letterSpacing: '-0.01em', margin: '0 24px 4px 0' }}>Performance report</div>
                <div style={{ fontSize: 12.5, color: '#9a9d97', margin: '0 24px 16px 0' }}>Over the past 30 days, your content earned <span style={{ color: '#eef0ea', fontWeight: 600 }}>77 clicks</span>.</div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '0 24px 14px 0' }}>
                  {analyticsNums.map((an) => (
                    <div key={an.label} style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14 }}>
                      <div style={{ fontSize: 10.5, color: '#7c7f77', marginBottom: 10 }}>{an.label}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 19, fontWeight: 500, color: '#f4f4f2' }}>{an.big}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: an.deltaColor }}>{an.delta}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="gv-strategysplit" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 12, margin: '0 24px 0 0' }}>
                  <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#eef0ea' }}>Organic performance</div>
                    <div style={{ fontSize: 10.5, color: '#6b6e68', margin: '2px 0 12px' }}>Clicks &amp; impressions from Google + answer engines</div>
                    <svg viewBox="0 0 400 110" preserveAspectRatio="none" style={{ width: '100%', height: 100, display: 'block' }}>
                      <polyline points="0,70 30,30 55,55 80,20 110,60 140,35 170,65 200,25 230,55 260,30 290,68 320,20 350,50 380,15 400,45" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="3 3" />
                      <polyline points="0,85 25,50 50,90 75,45 105,75 135,40 165,80 195,50 225,85 255,42 285,78 315,48 345,88 375,55 400,20" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="400" cy="20" r="3.5" fill={ACCENT} />
                    </svg>
                  </div>
                  <div style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#eef0ea', marginBottom: 2 }}>Traffic sources</div>
                    <div style={{ fontSize: 10.5, color: '#6b6e68', marginBottom: 14 }}>Where the clicks came from</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {trafficSources.map((ts) => (
                        <div key={ts.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#9a9d97' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: ts.color, flexShrink: 0 }} />
                          <span style={{ flex: 1 }}>{ts.name}</span>
                          <span style={{ fontWeight: 600, color: '#d7d9d3' }}>{ts.pct}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100, background: 'linear-gradient(to bottom, rgba(10,11,10,0), #0a0b0a 88%)', pointerEvents: 'none' }} />
              </div>

              <div className="gv-chatpanel" style={{ flex: '0 0 240px', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: '#141412', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '11px 12px' }}>
                  <div style={{ fontSize: 11, lineHeight: 1.5, color: '#c9cbc5' }}><span style={{ color: '#f4f4f2', fontWeight: 700 }}>/analytics</span> What&rsquo;s actually driving clicks this month?</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: '#6b6e68', marginBottom: 6 }}>Thought · 5s</div>
                  <p style={{ fontSize: 11.5, lineHeight: 1.55, color: '#9a9d97', margin: 0 }}>Google Search still drives the vast majority of visits. Impressions are climbing faster than clicks — a CTR opportunity.</p>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f2' }}>Changes</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b6e68' }}>Undo</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 10px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#d7d9d3', flexShrink: 0 }}>◑</span>
                    <span style={{ fontSize: 11.5, color: '#d7d9d3', flex: 1 }}>Titles</span>
                    <span style={{ fontSize: 10.5, color: '#6b6e68' }}>3 rewritten</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#55564f', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 999, padding: '9px 13px' }}>Add follow up…</div>
              </div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -10, height: 300, background: 'linear-gradient(180deg, rgba(11,11,11,0), #000000B3, #000000)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: -26, bottom: -26, right: -26, width: 300, background: 'linear-gradient(90deg, rgba(11,11,11,0), #000000)', pointerEvents: 'none' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, paddingTop: 24 }}>
            <div style={{ maxWidth: 480 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', color: '#7c7f77', textTransform: 'uppercase', marginBottom: 10 }}>Analytics agent</div>
              <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1, color: '#f4f4f2', marginBottom: 12 }}>Shows you what&rsquo;s actually working</div>
              <p style={leadStyle}>Ask a question in plain English, get an answer in plain English — which posts earn clicks, which are slipping, what to do next. No Search Console spreadsheet to decipher.</p>
            </div>
            <a className="gv-navlink gv-accentlink" href={startHref} style={{ color: '#d7d9d3', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>Explore the Analytics agent →</a>
          </div>
        </div>
      </section>

      {/* PLATFORM BENTO */}
      <section id="platform" style={{ padding: '90px 24px 220px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 44px' }}>
          <div style={eyebrow}>Under the hood</div>
          <h2 style={h2Style}>Everything a content team does.</h2>
          <p style={leadStyle}>Planning, writing, scheduling, publishing, distribution and reporting — connected, so nothing falls between tools.</p>
        </div>
        <div className="gv-r-left" style={{ borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', backgroundColor: '#000' }}>
          <div style={{ position: 'relative' }}>
            <div className="gv-bento" style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr 1fr', gridTemplateRows: '1.45fr 1.2fr 1.2fr', height: 800 }}>

              {/* Cross-post queue */}
              <div style={{ gridColumn: 1, gridRow: 1, borderRight: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '22px 34px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0 }}>
                <div>
                  <div style={{ fontSize: 14, color: '#f4f4f2', marginBottom: 4 }}>Cross-post queue</div>
                  <div style={{ fontSize: 11, color: '#7c7f77', marginBottom: 12 }}>One brief, every channel</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      { n: 'Blog post', s: 'Published', c: '#A2FF01EB', dot: '#7c7f77' },
                      { n: 'X thread', s: 'Posted', c: '#d7d9d3', dot: '#7c7f77' },
                      { n: 'LinkedIn', s: 'Posted', c: '#d7d9d3', dot: '#7c7f77' },
                    ].map((r) => (
                      <div key={r.n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color: r.dot === '#565952' ? '#9a9d97' : '#eef0ea' }}>{r.n}</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 500, color: r.c }}>{r.s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 12, paddingTop: 10 }}>Distribution →</div>
              </div>

              {/* Calendar */}
              <div style={{ gridColumn: '2 / 4', gridRow: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '30px 34px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden', position: 'relative', backgroundColor: '#000' }}>
                <div style={{ maxHeight: 195, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', backgroundColor: '#070707' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <span style={{ width: 17, height: 17, borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#9a9d97' }}>‹</span>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f2', letterSpacing: '-0.01em' }}>July 2026</div>
                      <span style={{ width: 17, height: 17, borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#9a9d97' }}>›</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                        <div key={d} style={{ padding: '4px 8px', fontSize: 9, color: '#7c7f77', borderRight: '1px solid rgba(255,255,255,0.06)' }}>{d}</div>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                      {(() => {
                        const posts: Record<number, string[]> = {
                          6: ['The 2026 Playbook for a …', 'The 7 Best AI 3D Icon Gen…'],
                          7: ['The 7 Best AI 3D Icon Gen…', 'The Reality of Using an AI…'],
                          10: ['How to Make Drop-In Re…'],
                          11: ['Venngage AI 3D Icon Gen…', 'How to Make a 3D Logo in…'],
                          15: ['The Best Automatic Back…'],
                          16: ['Finding the Best Auto Ba…'],
                        };
                        const planned: Record<number, string> = {
                          21: 'Automatic background r…', 22: 'Automatic background r…', 24: 'Automatic background r…',
                          28: 'How solo founders keep …', 30: 'I priced out a contract il…',
                        };
                        const cells: React.ReactNode[] = [];
                        const cell = (key: string, children?: React.ReactNode, pad = false) => (
                          <div key={key} style={{ borderRight: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '2px 4px', minHeight: 20, background: pad ? 'rgba(255,255,255,0.03)' : undefined, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>{children}</div>
                        );
                        for (let i = 0; i < 3; i++) cells.push(cell(`pad-a${i}`, undefined, true));
                        for (let d = 1; d <= 31; d++) {
                          const today = d === 18;
                          cells.push(cell(`d${d}`, (
                            <>
                              <div style={today
                                ? { fontSize: 8, color: '#e8e9e5', marginBottom: 1, background: 'rgba(255,255,255,0.14)', borderRadius: 4, width: 13, height: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }
                                : { fontSize: 8, color: '#9a9d97', marginBottom: 1 }}>{d}</div>
                              {(posts[d] || []).map((t, i) => (
                                <div key={i} style={{ fontSize: 6.5, color: ACCENT, background: '#3a3d37', borderRadius: 3, padding: '1px 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{t}</div>
                              ))}
                              {(posts[d]?.length ?? 0) > 1 && <div style={{ fontSize: 6.5, color: '#7c7f77', paddingLeft: 1 }}>+1 more</div>}
                              {planned[d] && (
                                <div style={{ fontSize: 6.5, color: '#9a9d97', border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 3, padding: '1px 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{planned[d]}</div>
                              )}
                            </>
                          )));
                        }
                        cells.push(cell('pad-b0', undefined, true));
                        return cells;
                      })()}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 12, position: 'relative', zIndex: 2 }}>Calendar →</div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: 'linear-gradient(180deg, rgba(28,28,26,0), #000000, #000000)', pointerEvents: 'none', zIndex: 0 }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 100, background: 'linear-gradient(90deg, rgba(28,28,26,0), #000000)', pointerEvents: 'none', zIndex: 0 }} />
              </div>

              {/* SERP */}
              <div style={{ gridColumn: 1, gridRow: '2 / 4', borderRight: '1px solid rgba(255,255,255,0.08)', padding: '44px 26px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', minHeight: 0 }}>
                <div style={{ minHeight: 0, position: 'relative' }}>
                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', backgroundColor: '#070707' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f2' }}>Openings Grove spotted</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: ACCENT }}>live SERP</span>
                    </div>
                    <div style={{ padding: 10, position: 'relative' }}>
                      <div style={{ fontSize: 10, color: '#7c7f77', marginBottom: 10, lineHeight: 1.4 }}>Queries you rank on page 2 for</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                          { kw: '3d icon generator', impr: '26 impr', rank: '#14.1' },
                          { kw: 'prevent off-brand assets', impr: '25 impr', rank: '#8.9' },
                          { kw: 'facebook ad fatigue', impr: '20 impr', rank: '#19.1' },
                        ].map((o) => (
                          <div key={o.kw} style={{ background: '#111110', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '9px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: '#b8bab4', background: 'rgba(255,255,255,0.08)', borderRadius: 5, padding: '2px 6px' }}>NEAR WIN</span>
                              <span style={{ fontSize: 9.5, color: '#7c7f77' }}>{o.impr}</span>
                            </div>
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#f4f4f2', marginBottom: 3 }}>{o.kw}</div>
                            <div style={{ fontSize: 9.5, color: '#7c7f77', lineHeight: 1.4 }}>Rank {o.rank} — a stronger page can reach page one.</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 100, background: 'linear-gradient(90deg, rgba(7,7,7,0), #070707B8, #000000)', pointerEvents: 'none' }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 79, zIndex: 5, paddingTop: 16 }}>Search openings →</div>
              </div>
              <div style={{ position: 'absolute', left: 0, bottom: 0, width: 365, height: 300, background: 'linear-gradient(180deg, rgba(28,28,26,0), #000000, #000000)', pointerEvents: 'none', zIndex: 0 }} />

              {/* Idea studio */}
              <div style={{ gridColumn: 2, gridRow: 2, borderRight: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '22px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0 }}>
                <div style={{ minHeight: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 5, background: '#111110', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 4, marginTop: 14 }}>
                      <span style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#f4f4f2', background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 0' }}>Idea studio</span>
                      <span style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 500, color: '#7c7f77', padding: '5px 0' }}>SEO set</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#b8bab4', background: '#111110', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px' }}>A strong opinion I hold</span>
                    <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#0a0a08', borderRadius: 8, padding: 7, backgroundColor: ACCENT }}>✦ Generate ideas</div>
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 7 }}>Idea studio →</div>
              </div>

              {/* Manager score */}
              <div style={{ gridColumn: 3, gridRow: 2, borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '22px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 200, background: 'linear-gradient(180deg, rgba(0,0,0,0), #000000, #000000)', pointerEvents: 'none', zIndex: 1 }} />
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '24px 0' }}>
                    <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'conic-gradient(#c7c9c3 0% 81%, rgba(255,255,255,0.08) 81% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#050705', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f2', lineHeight: 1 }}>81</span>
                        <span style={{ fontSize: 5.5, letterSpacing: '0.04em', color: '#7c7f77' }}>OVERALL</span>
                      </div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      {[['STRATEGIC FIT', 90], ['MARKETING', 85], ['CRAFT', 60], ['SAFETY', 95]].map(([n, v]) => (
                        <div key={n as string}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, letterSpacing: '0.03em', color: '#9a9d97', marginBottom: 2 }}><span>{n}</span><span>{v}</span></div>
                          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}><div style={{ width: `${v}%`, height: '100%', borderRadius: 2, background: '#c7c9c3' }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 10, position: 'relative', zIndex: 5 }}>Quality gate →</div>
              </div>

              {/* Analytics sparkline */}
              <div style={{ gridColumn: 2, gridRow: 3, borderRight: '1px solid rgba(255,255,255,0.08)', padding: '28px 26px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, position: 'relative' }}>
                <div>
                  <div style={{ background: '#0d0f0c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#9a9d97" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
                      <span style={{ fontSize: 12, color: '#9a9d97' }}>Organic clicks</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: '#f4f4f2', letterSpacing: '-0.02em' }}>78</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#e08585' }}>▼ 11%</span>
                    </div>
                    <svg viewBox="0 0 260 46" width="100%" height="46" preserveAspectRatio="none">
                      <path d="M0,30 L8,20 16,34 24,16 32,28 40,12 48,26 56,18 64,30 72,14 80,24 88,20 96,32 104,16 112,26 120,10 128,22 136,30 144,18 152,26 160,14 168,24 176,20 184,30 192,12 200,22 208,16 216,26 224,20 232,12 240,22 248,16 256,20" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 12, zIndex: 9 }}>Analytics →</div>
                <div style={{ position: 'absolute', left: 4, top: 72, height: 146, width: 338, background: 'linear-gradient(180deg, #00000000, #000000DC, #000000)', pointerEvents: 'none' }} />
              </div>

              {/* Canonical subdomain */}
              <div style={{ gridColumn: 3, gridRow: 3, padding: '28px 26px 24px 30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, position: 'relative' }}>
                <div style={{ marginBottom: 14 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111110', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '8px 12px', position: 'relative', overflow: 'hidden' }}>
                  <span style={{ width: 15, height: 15, borderRadius: 4, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#9a9d97', flexShrink: 0 }}>#</span>
                  <span style={{ fontSize: 10.5, color: '#9a9d97', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>https://<span style={{ color: ACCENT }}>blog.yourdomain.com</span></span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 500, color: '#f4f4f2', marginTop: 12 }}>Your own blog subdomain →</div>
                <div style={{ position: 'absolute', top: 32, left: 184, width: 163, height: 156, background: 'linear-gradient(90deg, rgba(17,17,16,0), #000000, #000000)', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '30px 24px 220px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 36px' }}>
          <div style={eyebrow}>Plans</div>
          <h2 style={{ ...h2Style, margin: '0 0 24px' }}>Start free. Pay when it&rsquo;s working.</h2>
          <div style={{ display: 'inline-flex', padding: 5, background: '#111110', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, gap: 4 }}>
            <button onClick={() => setBilling('monthly')} style={{ ...ctaBtn, border: 'none', cursor: 'pointer', padding: '0 20px', borderRadius: 999, background: isMonthly ? '#f4f4f2' : 'transparent', color: isMonthly ? '#0a0a08' : '#9a9d97' }}>Monthly</button>
            <button onClick={() => setBilling('annual')} style={{ ...ctaBtn, border: 'none', cursor: 'pointer', padding: '0 20px', borderRadius: 999, background: isMonthly ? 'transparent' : '#f4f4f2', color: isMonthly ? '#9a9d97' : '#0a0a08' }}>Annual <span style={{ fontSize: 11, opacity: 0.85, color: ACCENT }}>−{Math.round(ANNUAL_DISCOUNT * 100)}%</span></button>
          </div>
        </div>
        <div className="gv-pricegrid" style={{ display: 'grid', gridTemplateColumns: `repeat(${tiers.length}, 1fr)`, background: '#000', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18 }}>
          {tiers.map((tier, i) => (
            <div key={tier.name} style={{ position: 'relative', borderRight: i < tiers.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', padding: '32px 24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#f4f4f2', marginBottom: 2 }}>{tier.name}</div>
              <div style={{ fontSize: 13.5, color: '#8a8d86', lineHeight: 1.4, minHeight: '2.8em' }}>{tier.blurb}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '24px 0' }} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 24 }}>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: '#f4f4f2' }}>${tier.price}</span>
                <span style={{ fontSize: 13, color: '#8a8d86' }}>{tier.note}</span>
              </div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', marginBottom: 24 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15, flex: 1 }}>
                {tier.feats.map((ft) => (
                  <div key={ft} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: '#c9cbc5', lineHeight: 1.4, alignItems: 'baseline' }}><span style={{ color: '#565952', flexShrink: 0 }}>✓</span>{ft}</div>
                ))}
              </div>
              <a className="gv-btn" href={startHref} style={{ ...ctaBtn, textDecoration: 'none', width: '100%', border: `1px solid ${tier.popular ? 'transparent' : 'rgba(255,255,255,0.16)'}`, background: tier.popular ? ACCENT : 'transparent', color: tier.popular ? '#0a0a0a' : '#f4f4f2', padding: '0 12px', borderRadius: 8, marginTop: 28 }}>{tier.cta}</a>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 13.5, color: '#8a8d86', lineHeight: 1.6, marginTop: 24 }}>Every plan starts free — no card needed to see your first post. Cancel any time and keep everything published.</div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: '30px 24px 90px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-faqgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 40, alignItems: 'start' }}>
          <div className="gv-r">
            <div style={eyebrow}>FAQ</div>
            <h2 style={h2Style}>The honest FAQ.</h2>
            <p style={{ ...leadStyle, margin: '0 0 22px' }}>The questions skeptical founders actually ask before handing over their blog.</p>
            <a className="gv-btn" href={startHref} style={{ ...ctaBtn, background: '#f4f4f2', color: '#0a0a0a', padding: '0 22px', borderRadius: 9, textDecoration: 'none' }}>{loggedIn ? 'Open dashboard →' : 'Start free →'}</a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {faqs.map((f, i) => (
              <div key={f.q} style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, background: '#0e0e0d', overflow: 'hidden' }}>
                <button onClick={() => setFaqOpen(faqOpen === i ? -1 : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '17px 18px', color: '#f4f4f2', fontFamily: 'inherit', fontSize: 14, fontWeight: 700 }}>
                  <span style={{ flex: 1 }}>{f.q}</span>
                  <span style={{ color: '#7c7f77', fontSize: 19, lineHeight: 1, flexShrink: 0 }}>{faqOpen === i ? '–' : '+'}</span>
                </button>
                {faqOpen === i && (
                  <div style={{ padding: '0 18px 18px', fontSize: 14, color: '#9a9d97', lineHeight: 1.6 }}>{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FROM THE BLOG — grove's own embed, on grove's own landing page. This
          section is the product running against itself: same public/embed.js a
          customer pastes, same host API, themed by data-theme rather than by
          anything written here. If it looks wrong, fix embed.js. */}
      <section id="blog" style={{ padding: '30px 24px 40px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r" style={{ maxWidth: 620, marginBottom: 30 }}>
          <div style={eyebrow}>Dogfood</div>
          <h2 style={h2Style}>Our blog runs on Grove.</h2>
          <p style={leadStyle}>
            Nobody wrote these posts for this page. Grove researched, wrote and published
            them to our own domain, and what you see below is the same embed snippet we
            hand you, rendering the same feed. Judge us on it.
          </p>
        </div>
        <div className="gv-r">
          <GroveEmbed mode="widget" count={3} blogUrl="/blog" />
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: '162px 24px 175px', textAlign: 'center' }}>
        <div className="gv-r" style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ ...h2Style, lineHeight: 1.08, margin: '0 0 22px' }}>Your next post starts here.</h2>
          <p style={{ fontSize: 18, fontWeight: 500, color: '#9a9d97', margin: '0 0 32px' }}>Plant your domain tonight. Wake up to a researched, written and published post on your own site.</p>
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, maxWidth: 440, margin: '0 auto', background: '#111110', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 6px 6px 18px', height: 44 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: '#7c7f77', fontSize: 14 }}>https://</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourdomain.com" aria-label="Your domain" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#f4f4f2', fontSize: 14, fontFamily: 'inherit', minWidth: 0 }} />
            <button className="gv-btn" type="submit" style={{ ...ctaBtn, background: '#f4f4f2', color: '#0a0a0a', padding: '0 20px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Plant →</button>
          </form>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: '54px 24px 32px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="gv-r gv-footgrid" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 32, marginBottom: 40 }}>
          <div>
            <a href="#hero" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#f4f4f2', marginBottom: 14 }}>
              <img src="/landing/grove-mark.png" alt="Grove" style={{ width: 28, height: 28, objectFit: 'contain' }} />
              <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>Grove</span>
            </a>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#7c7f77', lineHeight: 1.6, maxWidth: 250, margin: 0 }}>Plant your domain once. Grove researches, writes and publishes the blog from there.</p>
          </div>
          {footcols.map((col) => (
            <div key={col.head}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565952', marginBottom: 16 }}>{col.head}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {col.links.map(([label, href]) => (
                  <a className="gv-navlink" key={label} href={href} style={{ fontSize: 12, fontWeight: 500, color: '#9a9d97', textDecoration: 'none' }}>{label}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 22, fontSize: 12, color: '#565952' }}>
          <span>© {new Date().getFullYear()} Grove — plant once, grow from there.</span>
        </div>
      </footer>
    </div>
  );
}
