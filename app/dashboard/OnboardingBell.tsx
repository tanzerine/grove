'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Icon from './gv-icons';
import { useChrome } from './chrome-context';
import type { ActivityKind } from '@/lib/notifications/feed';
import { useT } from './i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/**
 * The header notifications bell. Holds two deliberately different things:
 *  1. ACTIVITY — live "actual service" notifications (writing / review / published…),
 *     a neutral feed with status-coloured dots and timestamps.
 *  2. GET SET UP — the one-time onboarding guide, an accent-tinted checklist that
 *     only lists the steps STILL TO DO (done steps drop off) and disappears once
 *     the required steps are complete. Optional bonuses (e.g. social auto-post)
 *     are tagged and never keep the dot nagging.
 * Popover mechanics mirror AccountAvatarMenu (outside-click + Escape).
 */
export default function OnboardingBell() {
  const t = useT();
  const { onboarding, activity } = useChrome();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Show only the steps still to do — done steps drop off entirely. Sort so the
  // required "do this next" step leads and optional bonuses sink to the bottom.
  const remaining = onboarding.steps
    .filter((s) => !s.done)
    .sort((a, b) => Number(!!a.optional) - Number(!!b.optional));
  const showSetup = !onboarding.complete && remaining.length > 0;
  const items = activity.items;

  // Dot lights when there's something to act on: required setup left, or a draft
  // that needs review / a failed run. (Informational events don't nag.) Grey,
  // not accent — a "you have a task" nag isn't a primary action or live
  // status, it's exactly what lime is reserved from.
  const dotOn = showSetup || activity.attentionCount > 0;
  const dotColor = 'var(--gv-soft)';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} title={t(t('Notifications'))}
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative', width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bell" />
        {dotOn && (
          <span style={{ position: 'absolute', top: 9, right: 9, width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: '0 0 0 2px var(--gv-bg)' }} />
        )}
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360,
          background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 12, zIndex: 70,
          maxHeight: '78vh', overflowY: 'auto',
        }}>
          {/* ============ GET SET UP (onboarding) — accent-tinted checklist ============ */}
          {showSetup && (
            <div style={{ background: 'rgba(162,255,1,0.05)', border: '1px solid rgba(162,255,1,0.2)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT_INK }}>
                  <Icon name="compass" size={13} /> {t(t('Get set up'))}
                </span>
                <span style={{ fontSize: 11, color: 'var(--gv-dim)' }}>{onboarding.doneCount} of {onboarding.total} done</span>
              </div>
              <div style={{ marginTop: 9, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${onboarding.total ? Math.round((onboarding.doneCount / onboarding.total) * 100) : 0}%`, height: '100%', background: ACCENT, transition: 'width .3s' }} />
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {remaining.map((s, idx) => {
                  // The first non-optional remaining step is "do this next".
                  const isNext = idx === 0 && !s.optional;
                  return (
                    <Link key={s.id} href={s.href} onClick={() => setOpen(false)} className="gv-nav"
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '8px 8px', borderRadius: 9, textDecoration: 'none',
                        border: `1px solid ${isNext ? 'rgba(162,255,1,0.28)' : 'transparent'}`, background: isNext ? 'rgba(162,255,1,0.08)' : 'transparent' }}>
                      <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700,
                        background: isNext ? 'rgba(162,255,1,0.15)' : 'rgba(255,255,255,0.05)', color: isNext ? ACCENT_INK : 'var(--gv-dim)',
                        border: `1px solid ${isNext ? 'rgba(162,255,1,0.4)' : 'rgba(255,255,255,0.1)'}` }}>{s.n}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-ink)' }}>{s.title}</span>
                          {isNext && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ACCENT_INK, background: 'rgba(162,255,1,0.12)', border: '1px solid rgba(162,255,1,0.3)', borderRadius: 5, padding: '1px 5px' }}>{t(t('Next'))}</span>}
                          {s.optional && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, padding: '1px 5px' }}>{t(t('Optional'))}</span>}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--gv-faint)', marginTop: 2, lineHeight: 1.4 }}>{s.desc}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============ ACTIVITY — neutral feed of service events ============ */}
          <div style={{ padding: showSetup ? '2px 4px 0' : '4px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-dim)', padding: '4px 4px 8px' }}>{t(t('Activity'))}</div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--gv-faint)', padding: '8px 4px 10px' }}>
                {t(t('No activity yet — queue a topic and the pipeline starts working.'))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it) => {
                  const m = KIND_META[it.kind];
                  return (
                    <Link key={`${it.id}-${it.kind}`} href={it.href} onClick={() => setOpen(false)} className="gv-nav"
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 8px', borderRadius: 9, textDecoration: 'none' }}>
                      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
                        <Icon name={m.icon} size={14} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{it.label}</span>
                          <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--gv-fainter)' }}>{relTime(it.at)}</span>
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--gv-soft)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.postTitle}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const KIND_META: Record<ActivityKind, { color: string; bg: string; border: string; icon: string }> = {
  writing:   { color: 'var(--gv-sky)', bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.28)', icon: 'pen' },
  review:    { color: 'var(--gv-amber)', bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.3)',  icon: 'reviews' },
  scheduled: { color: 'var(--gv-blue)', bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.28)', icon: 'calendar' },
  published: { color: ACCENT_INK,    bg: 'rgba(162,255,1,0.12)',  border: 'rgba(162,255,1,0.3)',  icon: 'published' },
  failed:    { color: 'var(--gv-red-text)', bg: 'rgba(255,155,155,0.1)',  border: 'rgba(255,155,155,0.3)',  icon: 'alert' },
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    // Future (e.g. scheduled): show "in …".
    const f = -ms;
    const h = f / 3600000;
    if (h < 1) return `in ${Math.max(1, Math.round(f / 60000))}m`;
    if (h < 24) return `in ${Math.round(h)}h`;
    return `in ${Math.round(h / 24)}d`;
  }
  const m = ms / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString('en-US');
}
