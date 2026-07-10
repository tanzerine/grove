'use client';

import { useState } from 'react';
import { deriveBrandColors, accentForText } from '@/lib/blog-theme';

/**
 * Manual brand-color override. The homepage crawl guesses a palette, but it can
 * be wrong (a monochrome site, a color buried in a CSS var, a brand that just
 * differs from the marketing site). Here the owner pins primary + secondary; the
 * server derives the full banner/button palette the same way the crawler does,
 * and it wins over the crawled colors everywhere. Saving with the field cleared
 * reverts to whatever the crawl found.
 */
export default function ThemeColorsForm({
  domainId, initialPrimary, initialSecondary, hasOverride, crawledPrimary,
}: {
  domainId: string;
  initialPrimary: string;
  initialSecondary: string;
  hasOverride: boolean;
  crawledPrimary: string | null;
}) {
  const [primary, setPrimary] = useState(initialPrimary);
  const [secondary, setSecondary] = useState(initialSecondary);
  const [override, setOverride] = useState(hasOverride);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  // Same derivation the blog will use, so the preview is faithful.
  const derived = deriveBrandColors(primary, { secondary });
  const accent = accentForText(primary);

  async function send(body: Record<string, unknown>, after: () => void) {
    setState('saving');
    setError('');
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, ...body }),
    }).catch(() => null);
    if (res?.ok) {
      after();
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } else {
      const j = await res?.json().catch(() => null);
      setError(j?.error ?? 'could not save — try again');
      setState('error');
    }
  }

  const save = () => send({ brand_primary: primary, brand_secondary: secondary }, () => setOverride(true));
  const reset = () => send({ brand_primary: '' }, () => {
    setOverride(false);
    if (crawledPrimary) setPrimary(crawledPrimary);
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Swatch label="Primary" hint="banner + accents" value={primary} onChange={setPrimary} />
        <Swatch label="Secondary" hint="button" value={secondary} onChange={setSecondary} />

        {/* live preview: banner mockup + accent chip, using the real derivation */}
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 8 }}>
            Preview
          </div>
          <div style={{ borderRadius: 12, padding: '20px 18px', textAlign: 'center', background: derived.banner_bg, color: derived.banner_text }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: derived.banner_text_muted }}>
              Powered by your brand
            </div>
            <div style={{ fontFamily: 'Clash Display, sans-serif', fontSize: 17, margin: '5px 0 10px' }}>Try your product</div>
            <span style={{ display: 'inline-block', background: derived.btn_color, color: derived.btn_text_color, padding: '7px 16px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              Visit →
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: accent, display: 'inline-block' }} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--clay)' }}>links, table of contents &amp; tags</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button
          type="button" onClick={save} disabled={state === 'saving'}
          style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--moss)', background: 'var(--moss)', color: 'white', fontSize: 13, cursor: 'pointer', opacity: state === 'saving' ? 0.6 : 1 }}
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save colors'}
        </button>
        {override && (
          <button
            type="button" onClick={reset} disabled={state === 'saving'}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--line)', background: 'white', color: 'var(--ink)', fontSize: 13, cursor: 'pointer' }}
          >
            Reset to crawled colors
          </button>
        )}
        <span className="mono" style={{ fontSize: 12, color: 'var(--clay)' }}>
          {override ? 'Using your custom colors' : 'Using colors from your site'}
        </span>
      </div>
      {state === 'error' && <p style={{ color: '#c04b3c', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}

function Swatch({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 8 }}>
        {label} <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {hint}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={valid ? (value.length === 4 ? expand(value) : value) : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color`}
          style={{ width: 42, height: 42, border: '1px solid var(--line)', borderRadius: 10, background: 'white', padding: 2, cursor: 'pointer' }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="mono"
          style={{ width: 100, fontSize: 13, padding: '9px 10px', borderRadius: 10, border: `1px solid ${valid ? 'var(--line)' : '#e0a0a0'}`, background: 'white', color: 'var(--ink)' }}
        />
      </div>
    </div>
  );
}

function expand(hex: string): string {
  const h = hex.replace('#', '');
  return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
}
