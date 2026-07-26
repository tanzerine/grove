'use client';
import { useState } from 'react';

const PLANS = [
  { name: 'Starter', mo: 29, yr: 23, desc: 'For the solo founder finally starting the blog.', cta: 'Start free trial', primary: false,
    features: ['4 posts / month', '1 domain', 'Auto-publish + SSL + sitemap', 'Brand voice profiling', 'Review queue'] },
  { name: 'Growth', mo: 79, yr: 63, desc: 'For founders who want content to actually compound.', cta: 'Start free trial', primary: true,
    features: ['16 posts / month', '1 domain', 'Cross-post to X & LinkedIn', 'Ranking analytics dashboard', 'Full auto-pilot mode', 'Priority research sources'] },
  { name: 'Agency', mo: 199, yr: 159, desc: 'For teams running content across client sites.', cta: 'Talk to us', primary: false,
    features: ['10 sites, 8 posts each', 'Everything in Growth', 'Per-client brand voices', 'White-label blog & embed', 'Shared team workspace'] },
];

export default function PriceToggle() {
  const [cycle, setCycle] = useState<'mo' | 'yr'>('mo');
  return (
    <>
      <div className="price-toggle">
        <button className={cycle === 'mo' ? 'on' : ''} onClick={() => setCycle('mo')}>Monthly</button>
        <button className={cycle === 'yr' ? 'on' : ''} onClick={() => setCycle('yr')}>
          Yearly <span className="save">−20%</span>
        </button>
      </div>
      <div className="pricing" style={{ marginTop: 50 }}>
        {PLANS.map((p) => (
          <div key={p.name} className={`plan ${p.primary ? 'feat-plan' : ''}`}>
            {p.primary && <div className="pop">Most popular</div>}
            <div className="pname">{p.name}</div>
            <div className="pprice">
              <span className="cur">$</span>
              <span className="amt">{cycle === 'mo' ? p.mo : p.yr}</span>
              <span className="per">/mo</span>
            </div>
            <p className="pdesc">{p.desc}</p>
            <a href={`/signup?plan=${p.name.toLowerCase()}`} className={`btn ${p.primary ? 'btn-primary' : 'btn-ghost'}`}>
              {p.cta} {p.primary && <span className="arrow">→</span>}
            </a>
            <ul>
              {p.features.map((f, i) => (
                <li key={i}>
                  <span className="ck">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
