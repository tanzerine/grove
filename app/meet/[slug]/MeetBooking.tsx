'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  MEETING_LIMITS, formatSlot, formatTime, googleCalendarUrl, groupByDay, tzCity, tzOffsetLabel,
  upcomingSlots, zonedWallTimeToIso, type PublicMeeting,
} from '@/lib/meetings';

/**
 * The prospect's side of a meeting link.
 *
 * Renders nothing time-related until it knows the reader's zone: the server
 * can't, and painting the owner's zone first would flash Seoul times at
 * someone in Sofia. Every time on the page is shown in ONE zone the reader can
 * change, and anything they type is read in that same zone.
 */
export default function MeetBooking({ slug, initial }: { slug: string; initial: PublicMeeting }) {
  const [m, setM] = useState(initial);
  const [tz, setTz] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [zones, setZones] = useState<string[]>([]);

  const [pick, setPick] = useState<string | null>(initial.picked_start);
  const [suggesting, setSuggesting] = useState(false);
  const [proposals, setProposals] = useState<string[]>(['']);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone || initial.owner_tz;
    setTz(initial.prospect_tz || local);
    setNow(new Date());
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    setZones(Array.from(new Set([local, initial.owner_tz, ...all])));
  }, [initial.owner_tz, initial.prospect_tz]);

  const open = useMemo(() => (now ? upcomingSlots(m.slots, now) : []), [m.slots, now]);
  const days = useMemo(() => (tz ? groupByDay(open, tz) : []), [open, tz]);

  useEffect(() => {
    // Nothing on offer: go straight to suggesting.
    if (now && open.length === 0) setSuggesting(true);
  }, [now, open.length]);

  if (!tz || !now) return <div className="gv-auth-card gv-meet-card" aria-busy="true" style={{ minHeight: 420 }} />;

  const proposedIso = proposals.map((p) => (p ? zonedWallTimeToIso(p, tz) : null)).filter((p): p is string => !!p);
  const canSubmit = !busy && !!email.trim() && (!!pick || proposedIso.length > 0);
  const pageUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/meet/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pick, proposed: suggesting ? proposedIso : [], email, tz, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.message ?? 'Something went wrong. Try again.');
        return;
      }
      setM(json.meeting);
      setChanging(false);
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const zoneLabel = `${tzCity(tz)} · ${tzOffsetLabel(tz, now)}`;

  return (
    <div className="gv-auth-card gv-meet-card">
      <a href="/" className="gv-auth-brand" style={{ marginBottom: 18 }}>
        <svg className="gv-auth-mark" viewBox="0 0 32 32" aria-hidden><use href="#grove-mark" /></svg>
        <span>grove<span className="dot">.</span></span>
      </a>

      <div className="gv-meet-eyebrow">Call with Tae from Grove</div>
      <h1 className="gv-auth-title" style={{ marginBottom: 10 }}>{m.title}</h1>
      <div className="gv-meet-meta">
        <span>{m.duration_min} min</span>
        <span>Video call</span>
        {m.prospect_org ? <span>For {m.prospect_name} at {m.prospect_org}</span> : <span>For {m.prospect_name}</span>}
      </div>
      {m.owner_note && <p className="gv-meet-note">{m.owner_note}</p>}

      <label className="gv-meet-tz">
        <span>Times shown in</span>
        <select className="gv-auth-input gv-auth-select" value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">
          {zones.map((z) => <option key={z} value={z}>{z === tz ? zoneLabel : z.replace(/_/g, ' ')}</option>)}
        </select>
      </label>

      {m.status === 'cancelled' && (
        <div className="gv-meet-panel">
          <div className="gv-meet-panel-head">This link is closed</div>
          <p className="gv-meet-dim">Reply to Tae directly if you still want to talk.</p>
        </div>
      )}

      {m.status === 'confirmed' && m.confirmed_start && (
        <div className="gv-meet-panel gv-meet-panel-ok">
          <div className="gv-meet-panel-label">You're booked</div>
          <div className="gv-meet-panel-head">{formatSlot(m.confirmed_start, tz, m.duration_min)}</div>
          <div className="gv-meet-actions">
            {m.meeting_url && (
              <a className="gv-auth-submit gv-meet-btn" href={m.meeting_url} target="_blank" rel="noopener noreferrer">Join the call</a>
            )}
            <a className="gv-meet-ghost" href={googleCalendarUrl(m, m.confirmed_start, pageUrl)} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
            <a className="gv-meet-ghost" href={`/api/meet/${slug}/ics`}>Download .ics</a>
          </div>
          {!m.meeting_url && <p className="gv-meet-dim" style={{ marginTop: 12 }}>The video link will follow by email before the call.</p>}
        </div>
      )}

      {m.status === 'requested' && !changing && (
        <div className="gv-meet-panel">
          <div className="gv-meet-panel-label">Sent. Waiting on Tae to confirm</div>
          {m.picked_start && <div className="gv-meet-panel-head">{formatSlot(m.picked_start, tz, m.duration_min)}</div>}
          {m.proposed.length > 0 && (
            <div style={{ marginTop: m.picked_start ? 10 : 0 }}>
              {m.picked_start && <div className="gv-meet-dim" style={{ marginBottom: 4 }}>Also works for you:</div>}
              {m.proposed.map((p) => <div key={p} className={m.picked_start ? 'gv-meet-dim' : 'gv-meet-panel-head'}>{formatSlot(p, tz, m.duration_min)}</div>)}
            </div>
          )}
          <p className="gv-meet-dim" style={{ marginTop: 12 }}>You'll get a confirmation email with calendar links.</p>
          <button type="button" className="gv-meet-link" onClick={() => setChanging(true)}>Change my answer</button>
        </div>
      )}

      {(m.status === 'open' || (m.status === 'requested' && changing)) && (
        <form onSubmit={submit} className="gv-meet-form">
          {open.length > 0 && (
            <section>
              <h2 className="gv-meet-h2">Pick a time</h2>
              {days.map((d) => (
                <div key={d.key} className="gv-meet-day">
                  <div className="gv-meet-day-label">{d.label}</div>
                  <div className="gv-meet-slots">
                    {d.slots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`gv-meet-slot${pick === s ? ' is-on' : ''}`}
                        aria-pressed={pick === s}
                        onClick={() => setPick(pick === s ? null : s)}
                      >
                        {formatTime(s, tz)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {open.length > 0 && !suggesting && (
            <button type="button" className="gv-meet-link" onClick={() => setSuggesting(true)}>None of these work? Suggest a time</button>
          )}

          {suggesting && (
            <section>
              <h2 className="gv-meet-h2">{open.length ? 'Or suggest a time' : 'Suggest a time that works for you'}</h2>
              <p className="gv-meet-dim" style={{ margin: '0 0 10px' }}>In {tzCity(tz)} time. Up to {MEETING_LIMITS.proposals}.</p>
              <div className="gv-meet-proposals">
                {proposals.map((p, i) => (
                  <div key={i} className="gv-meet-proposal">
                    <input
                      type="datetime-local"
                      className="gv-auth-input"
                      value={p}
                      onChange={(e) => setProposals(proposals.map((x, j) => (j === i ? e.target.value : x)))}
                      aria-label={`Suggested time ${i + 1}`}
                    />
                    {proposals.length > 1 && (
                      <button type="button" className="gv-meet-x" aria-label="Remove" onClick={() => setProposals(proposals.filter((_, j) => j !== i))}>×</button>
                    )}
                  </div>
                ))}
              </div>
              {proposals.length < MEETING_LIMITS.proposals && (
                <button type="button" className="gv-meet-link" onClick={() => setProposals([...proposals, ''])}>+ Add another</button>
              )}
            </section>
          )}

          <section className="gv-auth-fields" style={{ marginTop: 6 }}>
            <input
              type="email"
              required
              className="gv-auth-input"
              placeholder="Your email, for the confirmation"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <textarea
              className="gv-auth-input"
              placeholder="Anything to know before the call? (optional)"
              rows={3}
              maxLength={MEETING_LIMITS.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ resize: 'vertical' }}
            />
            {err && <p className="gv-auth-err">{err}</p>}
            <button type="submit" className="gv-auth-submit" disabled={!canSubmit}>
              {busy
                ? 'Sending…'
                : pick
                  ? `Request ${formatSlot(pick, tz, m.duration_min).split(' · ')[0]}, ${formatTime(pick, tz)}`
                  : proposedIso.length
                    ? `Send ${proposedIso.length === 1 ? 'suggestion' : `${proposedIso.length} suggestions`}`
                    : 'Pick or suggest a time'}
            </button>
            {m.status === 'requested' && (
              <button type="button" className="gv-meet-link" onClick={() => setChanging(false)}>Keep my earlier answer</button>
            )}
          </section>
        </form>
      )}

      <p className="gv-meet-foot">
        Scheduling by <a href="/">grove.</a>
        {m.status === 'open' || m.status === 'requested' ? ' Nothing is booked until Tae confirms.' : ''}
      </p>
    </div>
  );
}
