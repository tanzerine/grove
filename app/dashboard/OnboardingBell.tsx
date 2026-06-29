'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Icon from './gv-icons';
import { useChrome } from './chrome-context';

const ACCENT = '#63c281';

/**
 * The header bell → a step-by-step "what to do next" guide. Reads real
 * onboarding progress from ChromeProvider (computed in the dashboard layout),
 * highlights the next incomplete step, and shows a green dot until everything's
 * done. Popover mechanics mirror AccountAvatarMenu (outside-click + Escape).
 */
export default function OnboardingBell() {
  const { onboarding } = useChrome();
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

  const { steps, doneCount, total, complete, nextN } = onboarding;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} title="Getting started"
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative', width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#9aa096', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bell" />
        {!complete && (
          <span style={{ position: 'absolute', top: 9, right: 9, width: 6, height: 6, borderRadius: '50%', background: ACCENT, boxShadow: '0 0 0 2px #0a0b0a' }} />
        )}
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340,
          background: '#15181a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 14, zIndex: 70,
        }}>
          {/* header + progress */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#eef1ea' }}>
              {complete ? "You're all set 🎉" : 'Get set up'}
            </div>
            <div style={{ fontSize: 11.5, color: '#8b9189' }}>{doneCount} of {total} done</div>
          </div>
          <div style={{ marginTop: 9, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: ACCENT, transition: 'width .3s' }} />
          </div>
          {!complete && (
            <div style={{ fontSize: 11.5, color: '#8b9189', marginTop: 9 }}>
              Follow these steps to get your blog running on autopilot.
            </div>
          )}

          {/* steps */}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {steps.map((s) => {
              const isNext = !s.done && s.n === nextN;
              return (
                <Link key={s.id} href={s.href} onClick={() => setOpen(false)} className="gv-nav"
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11, padding: '9px 9px', borderRadius: 10,
                    textDecoration: 'none',
                    border: `1px solid ${isNext ? 'rgba(99,194,129,0.28)' : 'transparent'}`,
                    background: isNext ? 'rgba(99,194,129,0.08)' : 'transparent',
                  }}>
                  {/* number / check badge */}
                  <span style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: '50%', marginTop: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                    background: s.done ? ACCENT : isNext ? 'rgba(99,194,129,0.15)' : 'rgba(255,255,255,0.05)',
                    color: s.done ? '#06120b' : isNext ? ACCENT : '#8b9189',
                    border: s.done ? 'none' : `1px solid ${isNext ? 'rgba(99,194,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                    {s.done ? <Icon name="check" size={13} /> : s.n}
                  </span>
                  {/* text */}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: s.done ? '#8b9189' : '#eef1ea' }}>{s.title}</span>
                      {isNext && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ACCENT, background: 'rgba(99,194,129,0.12)', border: '1px solid rgba(99,194,129,0.3)', borderRadius: 5, padding: '1px 5px' }}>Do this next</span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#6b6f67', marginTop: 2, lineHeight: 1.4, textDecoration: s.done ? 'line-through' : 'none' }}>{s.desc}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
