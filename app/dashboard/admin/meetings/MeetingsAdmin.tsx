'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  MEETING_LIMITS, formatSlot, formatTime, generateSlots, groupByDay, meetingSlug, tzCity,
  zonedWallTimeToIso, type MeetingRow, type MeetingStatus,
} from '@/lib/meetings';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';
const FAINT = 'var(--gv-faint)';

const card: React.CSSProperties = { background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px' };
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${LINE}`, background: 'var(--gv-veil-2)',
  color: 'var(--gv-ink)', font: 'inherit', fontSize: 13.5, outline: 'none', colorScheme: 'dark',
};
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: DIM };
const btn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 10, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)',
  font: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, border: `1px solid var(--gv-veil-line)`, background: 'transparent',
  color: 'var(--gv-ink)', font: 'inherit', fontSize: 13, cursor: 'pointer',
};

const STATUS: Record<MeetingStatus, { label: string; bg: string; fg: string }> = {
  requested: { label: 'Needs your confirm', bg: 'rgba(162,255,1,0.14)', fg: ACCENT_INK },
  open: { label: 'Waiting on them', bg: 'rgba(255,255,255,0.08)', fg: 'var(--gv-amber)' },
  confirmed: { label: 'Confirmed', bg: 'rgba(155,176,232,0.16)', fg: 'var(--gv-blue)' },
  cancelled: { label: 'Cancelled', bg: 'rgba(255,255,255,0.05)', fg: FAINT },
};

const ORDER: MeetingStatus[] = ['requested', 'open', 'confirmed', 'cancelled'];

function browserTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch { return 'Asia/Seoul'; }
}

function allZones(extra: string[]): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return Array.from(new Set([...extra.filter(Boolean), ...all]));
}

function tomorrow(tz: string): string {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function linkFor(m: Pick<MeetingRow, 'token' | 'prospect_org'>): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/meet/${meetingSlug(m.token, m.prospect_org)}`;
}

/**
 * Pick the times to offer: a daily window over N days (the usual case — "my
 * evenings next week") plus single times, previewed in the prospect's zone so
 * the owner can see the offer the way the prospect will.
 */
function SlotBuilder({
  slots, setSlots, ownerTz, previewTz, duration,
}: {
  slots: string[];
  setSlots: (s: string[]) => void;
  ownerTz: string;
  previewTz: string;
  duration: number;
}) {
  const [startDate, setStartDate] = useState(() => tomorrow(ownerTz));
  const [days, setDays] = useState(7);
  const [from, setFrom] = useState('20:00');
  const [to, setTo] = useState('23:00');
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [one, setOne] = useState('');
  const [note, setNote] = useState<string | null>(null);

  function add(more: string[]) {
    const merged = Array.from(new Set([...slots, ...more])).sort();
    if (merged.length > MEETING_LIMITS.slots) {
      setNote(`Kept the first ${MEETING_LIMITS.slots} times. Fewer, better times convert better anyway.`);
    } else {
      setNote(more.length ? null : 'That window produced no future times.');
    }
    setSlots(merged.slice(0, MEETING_LIMITS.slots));
  }

  const days_ = groupByDay(slots, ownerTz);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, alignItems: 'end' }}>
        <label style={label}>From day<input type="date" style={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label style={label}>Days<input type="number" min={1} max={30} style={input} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, +e.target.value || 1)))} /></label>
        <label style={label}>Daily from<input type="time" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={label}>until<input type="time" style={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
          <input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} /> Skip weekends
        </label>
        <button type="button" style={ghost} onClick={() => add(generateSlots({
          startDate, days, from, to, stepMin: duration, durationMin: duration, tz: ownerTz, skipWeekends,
        }, new Date()))}>Add window</button>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ ...label, flex: '1 1 200px' }}>Or one time ({tzCity(ownerTz)})
          <input type="datetime-local" style={input} value={one} onChange={(e) => setOne(e.target.value)} />
        </label>
        <button type="button" style={ghost} onClick={() => { const iso = zonedWallTimeToIso(one, ownerTz); if (iso) { add([iso]); setOne(''); } }}>Add time</button>
        {slots.length > 0 && <button type="button" style={{ ...ghost, color: DIM }} onClick={() => setSlots([])}>Clear all</button>}
      </div>
      {note && <div style={{ fontSize: 12.5, color: 'var(--gv-amber)' }}>{note}</div>}

      <div style={{ fontSize: 12, color: FAINT }}>
        {slots.length} / {MEETING_LIMITS.slots} times offered
        {previewTz && previewTz !== ownerTz ? ` · lime = their time in ${tzCity(previewTz)}` : ''}
      </div>
      {days_.map((d) => (
        <div key={d.key}>
          <div style={{ fontSize: 12, color: DIM, margin: '0 0 6px' }}>{d.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.slots.map((s) => (
              <span key={s} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 10px', borderRadius: 8,
                background: 'var(--gv-veil-2)', border: `1px solid ${LINE}`, fontSize: 12.5, color: 'var(--gv-ink)',
              }}>
                {formatTime(s, ownerTz)}
                {previewTz && previewTz !== ownerTz && <span style={{ color: ACCENT_INK }}>{formatTime(s, previewTz)}</span>}
                <button type="button" aria-label="Remove" onClick={() => setSlots(slots.filter((x) => x !== s))}
                  style={{ border: 'none', background: 'none', color: FAINT, cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text, label: l = 'Copy link' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" style={ghost} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? 'Copied' : l}</button>
  );
}

/**
 * The meetings desk: make a link, see who answered, confirm.
 *
 * Confirming is the only thing that emails the prospect, and it is always a
 * click here — never a link in the owner's notification email, which a mail
 * scanner could prefetch.
 */
export default function MeetingsAdmin({ initialRows }: { initialRows: MeetingRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [tz, setTz] = useState('Asia/Seoul');
  const [zones, setZones] = useState<string[]>(['Asia/Seoul']);

  // ── new link form ──────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [title, setTitle] = useState('Intro call');
  const [duration, setDuration] = useState(30);
  const [theirTz, setTheirTz] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [ownerNote, setOwnerNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<MeetingRow | null>(null);

  useEffect(() => {
    const b = browserTz();
    setTz(b);
    setZones(allZones([b, 'Asia/Seoul', 'Europe/Sofia', 'America/New_York']));
  }, []);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at)),
    [rows],
  );

  function replace(row: MeetingRow) {
    setRows((rs) => (rs.some((r) => r.id === row.id) ? rs.map((r) => (r.id === row.id ? row : r)) : [row, ...rs]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setErr(null);
    try {
      const res = await fetch('/api/admin/meetings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prospect_name: name, prospect_org: org || undefined, title, duration_min: duration,
          owner_tz: tz, slots, owner_note: ownerNote || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.message ?? json.error ?? 'Could not create the link.'); return; }
      replace(json.meeting);
      setCreated(json.meeting);
      setName(''); setOrg(''); setSlots([]); setOwnerNote('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <form onSubmit={create} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gv-ink)' }}>New meeting link</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label style={label}>Their name *<input style={input} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaloyan" /></label>
          <label style={label}>Company / product<input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Gavri" /></label>
          <label style={label}>Call title<input style={input} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label style={label}>Length
            <select style={input} value={duration} onChange={(e) => setDuration(+e.target.value)}>
              {[15, 20, 30, 45, 60].map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </label>
          <label style={label}>Your time zone
            <select style={input} value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label style={label}>Their time zone (preview)
            <select style={input} value={theirTz} onChange={(e) => setTheirTz(e.target.value)}>
              <option value="">Don't know</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
        </div>

        <SlotBuilder slots={slots} setSlots={setSlots} ownerTz={tz} previewTz={theirTz} duration={duration} />

        <label style={label}>Note on the page (optional)
          <textarea style={{ ...input, resize: 'vertical' }} rows={2} maxLength={MEETING_LIMITS.note} value={ownerNote}
            onChange={(e) => setOwnerNote(e.target.value)} placeholder="We'll set Grove up on your site together. Bring access to your repo." />
        </label>
        {err && <div style={{ fontSize: 13, color: 'var(--gv-red-text)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="submit" style={{ ...btn, opacity: busy || !name.trim() ? 0.6 : 1 }} disabled={!!busy || !name.trim()}>
            {busy === 'create' ? 'Creating…' : 'Create link'}
          </button>
          {slots.length === 0 && <span style={{ fontSize: 12.5, color: FAINT }}>No times added: they'll be asked to suggest some.</span>}
        </div>

        {created && (
          <div style={{ border: `1px solid rgba(162,255,1,0.35)`, background: 'rgba(162,255,1,0.05)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12.5, color: ACCENT_INK }}>Link ready for {created.prospect_name}</div>
            <code style={{ fontSize: 13, color: 'var(--gv-ink)', wordBreak: 'break-all' }}>{linkFor(created)}</code>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <CopyButton text={linkFor(created)} />
              <CopyButton label="Copy as a DM" text={`here's a link to pick a time, shows in your time zone: ${linkFor(created)}`} />
            </div>
          </div>
        )}
      </form>

      {sorted.length === 0 && <div style={{ ...card, color: DIM, fontSize: 13.5 }}>No meeting links yet.</div>}
      {sorted.map((m) => (
        <MeetingCard key={m.id} m={m} onChange={replace} busy={busy} setBusy={setBusy} />
      ))}
    </div>
  );
}

function MeetingCard({
  m, onChange, busy, setBusy,
}: {
  m: MeetingRow;
  onChange: (m: MeetingRow) => void;
  busy: string | null;
  setBusy: (b: string | null) => void;
}) {
  const [url, setUrl] = useState(m.meeting_url ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [offering, setOffering] = useState(false);
  const [newSlots, setNewSlots] = useState<string[]>([]);
  const st = STATUS[m.status];
  const show = (iso: string) => {
    const mine = formatSlot(iso, m.owner_tz, m.duration_min);
    const theirs = m.prospect_tz && m.prospect_tz !== m.owner_tz ? `${formatTime(iso, m.prospect_tz)} ${tzCity(m.prospect_tz)}` : null;
    return { mine, theirs };
  };

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/meetings/${m.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.message ?? json.error ?? 'Update failed.'); return; }
      onChange(json.meeting);
      if (json.emailed === 'sent') setMsg(`Confirmation emailed to ${json.meeting.prospect_email}.`);
      else if (json.emailed === 'skipped') setMsg('Confirmed. Email is off on this deploy (no RESEND_API_KEY), so tell them yourself.');
      else if (json.emailed === 'failed') setMsg('Confirmed, but the email failed. Tell them yourself.');
      else if (json.emailed === 'no_address') setMsg('Confirmed. They left no email, so tell them yourself.');
      setOffering(false);
    } finally {
      setBusy(null);
    }
  }

  const onTable = [
    ...(m.picked_start ? [{ iso: m.picked_start, tag: 'Their pick' }] : []),
    ...m.proposed.map((p) => ({ iso: p, tag: 'They suggested' })),
  ];

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12, opacity: m.status === 'cancelled' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--gv-ink)' }}>
          {m.prospect_name}{m.prospect_org ? ` · ${m.prospect_org}` : ''}
        </span>
        <span style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
        <span style={{ fontSize: 12, color: FAINT, marginLeft: 'auto' }}>{m.title} · {m.duration_min} min</span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ fontSize: 12.5, color: DIM, wordBreak: 'break-all', flex: '1 1 260px' }}>{linkFor(m)}</code>
        <CopyButton text={linkFor(m)} />
        <a href={linkFor(m)} target="_blank" rel="noopener noreferrer" style={{ ...ghost, display: 'inline-block' }}>Open</a>
      </div>

      {(m.prospect_email || m.prospect_note) && (
        <div style={{ fontSize: 13, color: 'var(--gv-soft)', lineHeight: 1.55 }}>
          {m.prospect_email && <div>{m.prospect_email}{m.prospect_tz ? ` · ${m.prospect_tz}` : ''}</div>}
          {m.prospect_note && <div style={{ color: DIM, whiteSpace: 'pre-wrap' }}>“{m.prospect_note}”</div>}
        </div>
      )}

      {m.status === 'confirmed' && m.confirmed_start && (
        <div style={{ fontSize: 14, color: 'var(--gv-ink)' }}>
          <b>{show(m.confirmed_start).mine}</b>
          {show(m.confirmed_start).theirs && <span style={{ color: ACCENT_INK }}> · {show(m.confirmed_start).theirs}</span>}
        </div>
      )}

      {m.status === 'requested' && onTable.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onTable.map(({ iso, tag }) => {
            const s = show(iso);
            return (
              <div key={iso} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: FAINT, width: 92 }}>{tag}</span>
                <span style={{ fontSize: 14, color: 'var(--gv-ink)' }}>{s.mine}</span>
                {s.theirs && <span style={{ fontSize: 13, color: ACCENT_INK }}>{s.theirs}</span>}
                <button type="button" style={{ ...btn, marginLeft: 'auto', padding: '7px 12px', fontSize: 13 }} disabled={!!busy}
                  onClick={() => act({ action: 'confirm', start: iso, meeting_url: url }, `confirm:${m.id}`)}>
                  {busy === `confirm:${m.id}` ? 'Confirming…' : 'Confirm'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {m.status === 'open' && (
        <div style={{ fontSize: 13, color: DIM }}>
          {m.slots.length ? `${m.slots.length} times offered, from ${formatSlot(m.slots[0], m.owner_tz, m.duration_min)}.` : 'No times offered: they will suggest.'}
        </div>
      )}

      {(m.status === 'requested' || m.status === 'confirmed') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ ...label, flex: '1 1 260px' }}>Video link (sent with the confirmation)
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/…" />
          </label>
          {m.status === 'confirmed' && m.confirmed_start && (
            <button type="button" style={ghost} disabled={!!busy}
              onClick={() => act({ action: 'confirm', start: m.confirmed_start, meeting_url: url }, `confirm:${m.id}`)}>
              Save link and re-send
            </button>
          )}
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: 'var(--gv-red-text)' }}>{err}</div>}
      {msg && <div style={{ fontSize: 13, color: ACCENT_INK }}>{msg}</div>}

      {m.status !== 'cancelled' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={ghost} onClick={() => setOffering(!offering)}>{offering ? 'Close' : 'Offer new times'}</button>
          <button type="button" style={{ ...ghost, color: 'var(--gv-red-soft)' }} disabled={!!busy}
            onClick={() => { if (confirm(`Cancel the link for ${m.prospect_name}? The page will say it's closed.`)) act({ action: 'cancel' }, `cancel:${m.id}`); }}>
            Cancel link
          </button>
        </div>
      )}

      {offering && (
        <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12.5, color: DIM }}>
            Replaces the offered times and puts the link back to “waiting on them”. Same link, so nothing to re-send.
          </div>
          <SlotBuilder slots={newSlots} setSlots={setNewSlots} ownerTz={m.owner_tz} previewTz={m.prospect_tz ?? ''} duration={m.duration_min} />
          <div>
            <button type="button" style={{ ...btn, opacity: newSlots.length ? 1 : 0.6 }} disabled={!newSlots.length || !!busy}
              onClick={() => act({ action: 'offer', slots: newSlots }, `offer:${m.id}`)}>
              Offer {newSlots.length || ''} times
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
