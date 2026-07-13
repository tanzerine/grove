'use client';

import { useState } from 'react';

/**
 * Sets domains.custom_blog_hostname — the customer-owned hostname (CNAME'd at
 * grove) the whole blog serves from. The zero-code counterpart to
 * CanonicalBaseForm: grove renders everything, the customer only adds DNS.
 */
type Attach = {
  state: 'attached' | 'already_attached' | 'skipped' | 'error';
  verified?: boolean;
  message?: string;
  cname?: { host: string; value: string };
};

export default function CustomHostnameForm({
  domainId, initial, hostname,
}: { domainId: string; initial: string | null; hostname: string }) {
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [attach, setAttach] = useState<Attach | null>(null);
  const apex = hostname.replace(/^www\./, '');

  async function save() {
    setState('saving');
    setError('');
    setAttach(null);
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, custom_blog_hostname: value.trim() }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok) {
      setAttach(body?.hostname_attach ?? null);
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } else {
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
          placeholder={`blog.${apex}`}
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

      {/* Auto-attach outcome. When grove attached the host to its Vercel project
          the customer only needs the DNS record; otherwise fall back to the
          manual instruction. */}
      {attach && (attach.state === 'attached' || attach.state === 'already_attached') && (
        <div style={{ margin: '10px 0 0', padding: '10px 12px', borderRadius: 10, background: 'var(--accent-soft, rgba(89,148,94,0.10))', border: '1px solid var(--moss)' }}>
          <p style={{ color: 'var(--ink)', fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
            ✓ Connected to grove automatically. Add one DNS record at your registrar and you&rsquo;re live:
          </p>
          <p className="mono" style={{ fontSize: 12.5, margin: '6px 0 0', color: 'var(--ink)' }}>
            CNAME&nbsp;&nbsp;{attach.cname?.host ?? 'blog'}&nbsp;→&nbsp;{attach.cname?.value ?? 'cname.vercel-dns.com'}
          </p>
          <p style={{ color: 'var(--clay)', fontSize: 12, margin: '6px 0 0', lineHeight: 1.5 }}>
            {attach.verified
              ? 'DNS verified — TLS is provisioning now.'
              : 'TLS provisions automatically once the record propagates (usually minutes).'}
          </p>
        </div>
      )}
      {attach && attach.state === 'error' && (
        <p style={{ color: 'var(--clay)', fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.55 }}>
          Saved, but grove couldn&rsquo;t auto-connect the host ({attach.message}). Add{' '}
          <span className="mono">{value.trim() || `blog.${apex}`}</span> under your Vercel project&rsquo;s Domains tab, then
          add the <span className="mono">CNAME → cname.vercel-dns.com</span> record.
        </p>
      )}

      {(!attach || attach.state === 'skipped') && (
        <p style={{ color: 'var(--clay)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
          Then add one DNS record at your registrar: <span className="mono">CNAME blog → cname.vercel-dns.com</span>.
          TLS is provisioned automatically once the record propagates. Leave empty to keep the grove-hosted URLs.
        </p>
      )}
    </div>
  );
}
