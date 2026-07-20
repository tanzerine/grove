import type { ReactNode } from 'react';

/**
 * Shared shell for the legal pages (/privacy, /terms) — same dark skin as the
 * landing so the footer links don't feel like leaving the site.
 */
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div style={{ background: '#0a0b0a', color: '#cdd2c9', minHeight: '100vh', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px 96px' }}>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#eef1ea', marginBottom: 40 }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #9ff0bb, #63c281)', boxShadow: '0 0 12px rgba(99,194,129,0.6)' }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>grove</span>
        </a>
        {/* The one big title on this page — GT Walsheim, weight 500 (its
            only shipped weight), matching every other page's single hero. */}
        <h1 style={{ fontSize: 'clamp(30px, 5vw, 44px)', fontWeight: 500, letterSpacing: '-0.03em', color: '#eef1ea', margin: '0 0 8px', fontFamily: "'GT Walsheim', 'Inter', sans-serif" }}>{title}</h1>
        <p style={{ fontSize: 13, color: '#6b6f67', margin: '0 0 40px' }}>Last updated {updated}</p>
        <div className="gv-legal" style={{ fontSize: 15, lineHeight: 1.7 }}>
          <style>{`
            .gv-legal h2 { font-size: 19px; font-weight: 600; color: #eef1ea; letter-spacing: -0.01em; margin: 36px 0 10px; }
            .gv-legal p, .gv-legal ul, .gv-legal section > div { margin: 0 0 14px; color: #9aa096; }
            .gv-legal ul { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
            .gv-legal strong { color: #cdd2c9; }
            .gv-legal a { color: #63c281; text-decoration: none; }
            .gv-legal a:hover { text-decoration: underline; }
          `}</style>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2>{heading}</h2>
      {typeof children === 'string' ? <p>{children}</p> : <div>{children}</div>}
    </section>
  );
}
