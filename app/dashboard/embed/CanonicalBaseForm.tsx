'use client';

import { useState } from 'react';

/**
 * Sets domains.canonical_blog_base — the customer-hosted article base every
 * canonical/sitemap/RSS/JSON-LD/social URL points at when configured. This is
 * the "your domain gets the SEO" switch, so the copy explains the contract.
 */
export default function CanonicalBaseForm({
  domainId, initial, hostname,
}: { domainId: string; initial: string | null; hostname: string }) {
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  async function save() {
    setState('saving');
    setError('');
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, canonical_blog_base: value.trim() }),
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
          placeholder={`https://${hostname.replace(/^www\./, '')}/blog`}
          spellCheck={false}
          className="mono"
          style={{
            flex: '1 1 280px', fontSize: 13, padding: '9px 12px', borderRadius: 10,
            border: '1px solid var(--line)', background: 'white', color: 'var(--ink)',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving'}
          style={{
            padding: '9px 16px', borderRadius: 10, border: '1px solid var(--moss)',
            background: 'var(--moss)', color: 'white', fontSize: 13, cursor: 'pointer',
            opacity: state === 'saving' ? 0.6 : 1,
          }}
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {state === 'error' && (
        <p style={{ color: '#c04b3c', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
      )}
      <p style={{ color: 'var(--clay)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
        Leave empty to keep the grove-hosted URLs canonical. Clearing the field switches back instantly.
      </p>
    </div>
  );
}
