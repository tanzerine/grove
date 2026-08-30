'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Icon from './gv-icons';
import { useUpsell } from './Upsell';
import { useT } from './i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default function PipelineActions({ domainId }: { domainId?: string }) {
  const t = useT();
  const r = useRouter();
  const { gate } = useUpsell();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggErr, setSuggErr] = useState(false);

  async function enqueue() {
    if (!domainId || !topic.trim()) return;
    // Free/lapsed accounts get the upsell instead of a doomed 402. `suggest`
    // stays open on purpose — real, personalized topic ideas are the tease.
    if (!gate('generate')) return;
    setBusy(true);
    await fetch('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, topic }),
    });
    setBusy(false); setTopic(''); setSuggestions([]); setOpen(false);
    r.refresh();
  }

  async function suggest() {
    if (!domainId) return;
    setOpen(true); setSuggesting(true); setSuggErr(false);
    try {
      const res = await fetch(`/api/topics/suggest?domain_id=${domainId}`);
      const json = await res.json().catch(() => ({}));
      const s: string[] = json.suggestions ?? [];
      if (s.length > 0) setSuggestions(s); else setSuggErr(true);
    } catch { setSuggErr(true); }
    setSuggesting(false);
  }

  const ghost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(162,255,1,0.25)', background: 'rgba(162,255,1,0.06)', color: ACCENT_INK, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '11px 15px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' };

  // Cheap funnel-intent read on the suggestion's own wording — not a model
  // call, just a legible label so suggestions read like the strategy plan's
  // TOFU/MOFU/BOFU intent chips instead of an undifferentiated list.
  function intentOf(s: string): string {
    const t = s.toLowerCase();
    if (/\bvs\.?\b|pricing|compare|alternativ|cost of|hiring/.test(t)) return 'BOFU';
    if (/checklist|metrics|mistake|activation|retention|onboarding/.test(t)) return 'MOFU';
    return 'TOFU';
  }

  return (
    <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 13, padding: '16px 18px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enqueue()}
          placeholder={t("Add a topic… e.g. 'reduce churn with onboarding nudges'")}
          style={{ flex: '1 1 220px', minWidth: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '11px 14px', color: 'var(--gv-ink)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }}
        />
        <button onClick={suggest} disabled={suggesting || !domainId} className="gv-ghost" style={ghost}>
          <Icon name="sparkle" size={13} />{suggesting ? t('Thinking…') : t('Suggest')}
        </button>
        <button onClick={enqueue} disabled={busy || !topic.trim()} className="gv-btn"
          style={{ border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '11px 18px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy || !topic.trim() ? 0.6 : 1 }}>
          {busy ? '…' : t('Queue topic')}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: ACCENT_INK, display: 'flex' }}><Icon name="sparkle" size={13} /></span> {t('Grove suggests · from your strategy & live SERP')}
          </div>
          {suggErr && (
            <p style={{ fontSize: 12, color: 'var(--gv-red-soft)', margin: '0 0 8px' }}>{t(t('Couldn’t generate suggestions — build the site profile first.'))}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((s, i) => (
              <button key={i} className="gv-sugg" onClick={() => { setTopic(s); setOpen(false); }}
                style={{ textAlign: 'left', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--gv-line)', borderRadius: 9, fontSize: 13, color: 'var(--gv-soft)', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, color: 'var(--gv-dim)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>{intentOf(s)}</span>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginTop: 12 }}>
        Prefer to write it yourself?{' '}
        <Link href="/dashboard/write" style={{ color: ACCENT_INK, fontWeight: 600 }}>{t(t('Open the writing desk →'))}</Link>
      </div>
    </div>
  );
}
