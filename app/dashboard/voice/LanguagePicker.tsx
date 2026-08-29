'use client';

import { useState } from 'react';
import { allLanguages, normalizeLang, type LangCode } from '@/lib/language';

/**
 * Sets domains.language — the language every future article is written in.
 *
 * It sits on the Brand voice page because that's what it is: the same kind of
 * input as persona and tone, and the one the writer can't infer. Saving takes
 * effect on the next generation; nothing already published is rewritten, which
 * is stated on the card so nobody expects a bulk translation.
 */
export default function LanguagePicker({
  domainId, initial,
}: { domainId: string; initial: string | null }) {
  const [value, setValue] = useState<LangCode>(normalizeLang(initial));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  async function save(next: LangCode) {
    const prev = value;
    setValue(next);
    setState('saving');
    setError('');
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, language: next }),
    }).catch(() => null);
    if (res?.ok) {
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } else {
      const body = await res?.json().catch(() => null);
      setValue(prev);                       // don't leave the UI claiming a save that failed
      setError(body?.error ?? 'could not save — try again');
      setState('error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {allLanguages().map((l) => {
          const on = l.code === value;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => { if (!on) save(l.code); }}
              disabled={state === 'saving'}
              aria-pressed={on}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start',
                padding: '10px 14px', borderRadius: 12, cursor: on ? 'default' : 'pointer',
                border: `1px solid ${on ? 'var(--gv-accent)' : 'rgba(255,255,255,0.1)'}`,
                background: on ? 'var(--gv-accent)' : 'rgba(255,255,255,0.04)',
                color: on ? 'var(--gv-on-accent)' : 'var(--gv-soft)',
                opacity: state === 'saving' ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.nativeName}</span>
              <span style={{ fontSize: 11, opacity: 0.75 }}>{l.englishName}</span>
            </button>
          );
        })}
      </div>
      {state === 'error' && (
        <p style={{ color: 'var(--gv-red)', fontSize: 12.5, margin: '10px 0 0' }}>{error}</p>
      )}
      <p style={{ color: 'var(--gv-dim)', fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.55 }}>
        {state === 'saved' ? 'Saved ✓ — ' : ''}
        Applies to articles written from now on: the title, the body, the FAQ, the
        social posts, and the blog chrome your readers see. Research is run in this
        language too, so the sources cited are ones your readers can open. Already
        published articles stay as they are.
      </p>
    </div>
  );
}
