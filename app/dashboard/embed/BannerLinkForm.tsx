'use client';

import { useState } from 'react';
import { useT } from '../i18n';

/**
 * Sets domains.cta_url — where the "Try {business}" banner at the bottom of
 * every article sends readers (hosted blog AND embed). Empty keeps the
 * default: the customer's homepage.
 */
export default function BannerLinkForm({
  domainId, initial, hostname,
}: { domainId: string; initial: string | null; hostname: string }) {
  const t = useT();
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  async function save() {
    setState('saving');
    setError('');
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, cta_url: value.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } else {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? 'could not save — try again');
      setState('error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`https://${hostname.replace(/^www\./, '')}/signup`}
          spellCheck={false}
          className="mono"
          style={{
            flex: '1 1 280px', fontSize: 13, padding: '9px 12px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--gv-ink)',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving'}
          style={{
            padding: '9px 16px', borderRadius: 10, border: 'none',
            background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontSize: 13, cursor: 'pointer',
            opacity: state === 'saving' ? 0.6 : 1,
          }}
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {state === 'error' && (
        <p style={{ color: 'var(--gv-red)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
      )}
      <p style={{ color: 'var(--gv-dim)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
        {t('Must be an https URL. Leave empty to send readers to your homepage.')}
      </p>
    </div>
  );
}
