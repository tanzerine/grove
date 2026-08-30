'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from '../../gv-icons';
import LocalTime from '../../LocalTime';
import {
  parseScheduleInput,
  relativeSchedule,
  schedulePresets,
  toLocalInputValue,
} from '@/lib/publish-schedule';
import { useT } from '../../i18n';

/**
 * "When should this go out?" — the author's own publish time, from the editor.
 *
 * Until now a publish date could only be set by the strategy plan, the
 * auto-publish cadence, or by dragging a post around the calendar; a draft the
 * author wrote themselves could only be published right now. This writes
 * `scheduled_at` + `status = 'scheduled'`, which the scheduler cron picks up.
 */

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default function SchedulePicker({
  scheduledAt, willPublish = true, disabled, onSchedule, onClear,
}: {
  scheduledAt: string | null;
  /** False when the post carries a date but isn't `scheduled` — a plan slot's
   *  target on a draft still held for review. The cron only ever publishes
   *  `scheduled`, so the button must not imply this one is about to go out. */
  willPublish?: boolean;
  disabled?: boolean;
  onSchedule: (iso: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<ReturnType<typeof schedulePresets>>([]);
  // "in 3 hours" depends on the reader's clock — render it after mount so the
  // server's HTML and the client's first paint can't disagree.
  const [mounted, setMounted] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Presets are local-time derived, so they're computed on open (client only) —
  // computing them during render would differ between server and client.
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setPresets(schedulePresets(now));
    setCustom(toLocalInputValue(scheduledAt ? new Date(scheduledAt) : new Date(now.getTime() + 3600_000)));
    setErr(null);
  }, [open, scheduledAt]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  async function commit(iso: string) {
    setBusy(true); setErr(null);
    try {
      await onSchedule(iso);
      setOpen(false);
    } catch (e: any) {
      setErr(String(e?.message ?? e) || t('Could not schedule this post.'));
    }
    setBusy(false);
  }

  async function commitCustom() {
    const parsed = parseScheduleInput(custom);
    if (!parsed.ok) { setErr(parsed.error); return; }
    await commit(parsed.iso);
  }

  async function clear() {
    setBusy(true); setErr(null);
    try {
      await onClear();
      setOpen(false);
    } catch (e: any) {
      setErr(String(e?.message ?? e) || t('Could not clear the schedule.'));
    }
    setBusy(false);
  }

  // Accent means "this is going out on its own". A date on a draft that's still
  // held for review is a plan, not a commitment, so it reads as neutral chrome.
  const committed = !!scheduledAt && willPublish;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} className="gv-ghost"
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          border: `1px solid ${committed ? 'rgba(162,255,1,0.3)' : 'rgba(255,255,255,0.1)'}`,
          background: committed ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.02)',
          color: committed ? ACCENT_INK : 'var(--gv-soft)',
          fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9,
          cursor: disabled ? 'default' : 'pointer',
        }}>
        <span style={{ display: 'flex' }}><Icon name="calendar" size={14} /></span>
        {scheduledAt
          ? <><LocalTime iso={scheduledAt} />{mounted && <span style={{ color: 'var(--gv-faint)', fontWeight: 500 }}>· {relativeSchedule(scheduledAt, new Date(), { willPublish })}</span>}</>
          : t('Schedule')}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 40, width: 292,
          background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14,
          padding: 14, boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
        }}>
          <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 10 }}>
            {t('Publish this post')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {presets.map((p) => (
              <button key={p.key} onClick={() => commit(p.iso)} disabled={busy} className="gv-tool"
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '9px 11px', borderRadius: 9, cursor: busy ? 'default' : 'pointer' }}>
                <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="clock" size={13} /></span>
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />

          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--gv-dim)', marginBottom: 7 }}>
            {t('Or pick a date and time')}
          </label>
          <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: '8px 10px', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', colorScheme: 'dark' }} />

          {err && <p style={{ fontSize: 11.5, color: 'var(--gv-red)', margin: '9px 0 0' }}>{err}</p>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 11 }}>
            <button onClick={commitCustom} disabled={busy} className="gv-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '8px 13px', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
              <Icon name="check" size={13} /> {busy ? t('Saving…') : scheduledAt ? t('Reschedule') : t('Schedule')}
            </button>
            {scheduledAt && (
              <button onClick={clear} disabled={busy} className="gv-ghost"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '8px 13px', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
                {t('Unschedule')}
              </button>
            )}
          </div>

          <p style={{ fontSize: 11, color: 'var(--gv-faint)', lineHeight: 1.5, margin: '11px 0 0' }}>
            {t('grove saves the draft and publishes it at that time, in your local timezone.')}
          </p>
        </div>
      )}
    </div>
  );
}
