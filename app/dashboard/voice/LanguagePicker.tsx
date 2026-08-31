'use client';

import { useState } from 'react';
import { allLanguages, normalizeLang, type LangCode } from '@/lib/language';
import { useT } from '../i18n';

/**
 * The language control for a site — `domains.language`.
 *
 * It sets ONE thing and moves everything: what this blog publishes in, and
 * what grove itself speaks while you're managing this site. Those used to be
 * two settings in two places (this one, plus a picker in the account menu),
 * which meant an owner could put one site in English, switch to it, and still
 * be looking at a Korean dashboard with no way to tell which control had won.
 *
 * Saving reloads the page rather than calling router.refresh(): the locale is
 * resolved on the SERVER for every RSC in the tree, so a client-side refresh
 * would leave server-rendered labels on the old language.
 */
export default function LanguagePicker({
  domainId, initial,
}: { domainId: string; initial: string | null }) {
  const t = useT();
  const [value, setValue] = useState<LangCode>(normalizeLang(initial));
  const [saving, setSaving] = useState<LangCode | null>(null);
  const [error, setError] = useState('');

  async function pick(next: LangCode) {
    if (next === value || saving) return;
    const prev = value;
    setValue(next);
    setSaving(next);
    setError('');
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, language: next }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.reload();
      return;                                  // stays disabled through the reload
    }
    const body = await res?.json().catch(() => null);
    setValue(prev);                            // never leave the UI claiming a save that failed
    setError(body?.error ?? t('Could not change the language — try again.'));
    setSaving(null);
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
              onClick={() => pick(l.code)}
              disabled={saving !== null}
              aria-pressed={on}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start',
                padding: '10px 14px', borderRadius: 12, cursor: on ? 'default' : 'pointer',
                border: `1px solid ${on ? 'var(--gv-accent)' : 'rgba(255,255,255,0.1)'}`,
                background: on ? 'var(--gv-accent)' : 'rgba(255,255,255,0.04)',
                color: on ? 'var(--gv-on-accent)' : 'var(--gv-soft)',
                opacity: saving && saving !== l.code ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.nativeName}</span>
              <span style={{ fontSize: 11, opacity: 0.75 }}>{l.englishName}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p style={{ color: 'var(--gv-red-text)', fontSize: 12.5, margin: '10px 0 0' }}>{error}</p>
      )}
      <p style={{ color: 'var(--gv-dim)', fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.55 }}>
        {saving
          ? t('Switching…')
          : t('One setting for this site: what grove writes in — articles, FAQs, social posts, the plan — and what grove speaks to you in while you manage it. Applies the moment you pick. Research runs in this language too, so the sources cited are ones your readers can open. Already published articles stay as they are.')}
      </p>
    </div>
  );
}
