'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useChrome } from './chrome-context';
import { useT } from './i18n';
import { UI_LOCALES, localeName, coverage, type UiLocale } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/**
 * The top-right avatar in every page header → the personal account menu:
 * billing, admin (owner only), jump to the live site / Grove home, and log out.
 * Reads account context (email, admin, active hostname) from ChromeProvider.
 */
export default function AccountAvatarMenu() {
  const { email, isAdmin, activeHostname, locale } = useChrome();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<UiLocale | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  /**
   * Switch the language grove speaks to this person. A full reload rather than
   * router.refresh(): the locale is resolved on the SERVER and rides the
   * Chrome context, so every RSC in the tree has to re-render against the new
   * cookie — a client-side refresh would leave server-rendered labels stale.
   */
  async function pickLocale(next: UiLocale) {
    if (next === locale) { setOpen(false); return; }
    setSaving(next);
    const res = await fetch('/api/account/language', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    }).catch(() => null);
    if (res?.ok) window.location.reload();
    else setSaving(null);
  }

  async function logout() {
    setBusy(true);
    try { await supabaseBrowser().auth.signOut(); } catch { /* clear locally regardless */ }
    window.location.href = '/';
  }

  const initials = (email?.split('@')[0]?.slice(0, 2) ?? 'G').toUpperCase();
  const site = activeHostname ? `https://${activeHostname.replace(/^https?:\/\//, '')}` : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={t('Account')}
        style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(162,255,1,0.3), rgba(162,255,1,0.1))', border: '1px solid rgba(162,255,1,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: ACCENT_INK, cursor: 'pointer' }}>
        {initials}
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 220,
          background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 6, zIndex: 70,
        }}>
          {email && (
            <div style={{ padding: '8px 10px 6px' }}>
              <div style={{ fontSize: 11, color: 'var(--gv-fainter)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('Signed in')}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
            </div>
          )}
          <Divider />
          <Item href="/dashboard/billing" onClick={() => setOpen(false)}>{t('Billing & plan')}</Item>
          {isAdmin && <Item href="/dashboard/admin" onClick={() => setOpen(false)}>{t('Admin overview')}</Item>}
          {site && <Item href={site} external>{t('Visit your site ↗')}</Item>}
          <Item href="/" external>{t('Grove home page ↗')}</Item>
          <Divider />
          <div style={{ padding: '8px 10px 4px' }}>
            <div style={{ fontSize: 11, color: 'var(--gv-fainter)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('Language')}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 8px' }}>
            {UI_LOCALES.map((code) => {
              const on = code === locale;
              // Spanish and Chinese are scaffolds: most of the dashboard still
              // renders English under them. Saying so on the button is kinder
              // than letting someone discover it one screen at a time.
              const partial = !on && coverage(code) < 0.6;
              return (
                <button
                  key={code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  disabled={saving !== null}
                  onClick={() => pickLocale(code)}
                  title={partial ? t('Partly translated — the rest stays in English') : undefined}
                  style={{
                    padding: '5px 9px', borderRadius: 8, fontSize: 12, cursor: on ? 'default' : 'pointer',
                    border: `1px solid ${on ? ACCENT : 'rgba(255,255,255,0.1)'}`,
                    background: on ? 'rgba(162,255,1,0.14)' : 'transparent',
                    color: on ? ACCENT_INK : 'var(--gv-soft)',
                    opacity: saving && saving !== code ? 0.5 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {localeName(code)}{partial ? ' ·' : ''}
                </button>
              );
            })}
          </div>
          <Divider />
          <button role="menuitem" onClick={logout} disabled={busy}
            style={{ ...itemStyle, color: 'var(--gv-red-text)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            {busy ? t('Logging out…') : t('Log out')}
          </button>
        </div>
      )}
    </div>
  );
}

const itemStyle: React.CSSProperties = { display: 'block', padding: '9px 10px', borderRadius: 8, fontSize: 13, color: 'var(--gv-soft)', textDecoration: 'none' };

function Item({ href, children, external, onClick }: { href: string; children: React.ReactNode; external?: boolean; onClick?: () => void }) {
  if (external) return <a className="gv-nav" href={href} target="_blank" rel="noopener noreferrer" style={itemStyle}>{children}</a>;
  return <Link className="gv-nav" href={href} onClick={onClick} style={itemStyle}>{children}</Link>;
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--gv-line)', margin: '4px 0' }} />;
}
