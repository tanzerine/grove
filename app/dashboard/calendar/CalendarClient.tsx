'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Post = {
  id: string;
  title: string | null;
  topic: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  slug?: string | null;
  slot_id?: string | null;
};

export type PlannedSlot = {
  slot_id: string;
  topic: string;
  intent: string;
  publish_date: string;
};

const ACCENT = 'var(--gv-accent)';

// One visual language for every state a day can carry — chip fill/border,
// legend swatch, and the day-panel status dot all read from this.
type EsKey = 'published' | 'scheduled' | 'review' | 'drafting' | 'planned';
const ES: Record<EsKey, { name: string; color: string; bg: string; border: string; line: 'solid' | 'dashed' | 'dotted' | 'double'; dot: string }> = {
  published: { name: 'Published', color: 'var(--gv-accent-ink)', bg: 'rgba(162,255,1,0.16)', border: 'rgba(162,255,1,0.4)', line: 'solid', dot: ACCENT },
  scheduled: { name: 'Scheduled', color: 'var(--gv-soft)', bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.22)', line: 'dashed', dot: 'var(--gv-soft)' },
  review: { name: 'Review', color: '#c2c6be', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.2)', line: 'dotted', dot: '#c2c6be' },
  drafting: { name: 'Drafting', color: 'var(--gv-dim)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.16)', line: 'double', dot: 'var(--gv-dim)' },
  planned: { name: 'Planned', color: 'var(--gv-fainter)', bg: 'transparent', border: 'rgba(255,255,255,0.18)', line: 'dashed', dot: 'var(--gv-fainter)' },
};
const DRAFTING = new Set(['queued', 'researching', 'writing']);
function statusKey(status: string): EsKey {
  if (status === 'published' || status === 'scheduled' || status === 'review') return status;
  return 'drafting';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getPostDate(p: Post): Date | null {
  const raw = p.published_at || p.scheduled_at;
  return raw ? new Date(raw) : null;
}
function pad(n: number) { return String(n).padStart(2, '0'); }
/** ISO instant → value for <input type="datetime-local"> in the viewer's local tz. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CalendarClient({
  domainId, posts, unscheduledReview, plannedSlots = [],
}: {
  domainId?: string;
  posts: Post[];
  unscheduledReview: Post[];
  plannedSlots?: PlannedSlot[];
}) {
  const r = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [busy, setBusy] = useState(false);
  // unified editor: scheduling a review post OR rescheduling an existing one
  const [edit, setEdit] = useState<{ postId: string; datetime: string } | null>(null);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  type Cell = { day: number; out: boolean };
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: prevMonthDays - firstWeekday + 1 + i, out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, out: false });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - (firstWeekday + daysInMonth) + 1, out: true });

  // group posts + planned slots by day-of-month for the visible month
  const postsByDate = new Map<string, Post[]>();
  for (const p of posts) {
    const d = getPostDate(p);
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = `${d.getDate()}`;
    (postsByDate.get(key) ?? postsByDate.set(key, []).get(key)!).push(p);
  }
  const plannedByDate = new Map<string, PlannedSlot[]>();
  for (const s of plannedSlots) {
    const d = new Date(s.publish_date);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = `${d.getDate()}`;
    (plannedByDate.get(key) ?? plannedByDate.set(key, []).get(key)!).push(s);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
    setSelectedDay(null); setEdit(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
    setSelectedDay(null); setEdit(null);
  }

  async function saveSchedule() {
    if (!edit || !domainId) return;
    setBusy(true);
    await fetch(`/api/posts/${edit.postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // datetime-local is local time → toISOString() gives the correct UTC instant
        scheduled_at: new Date(edit.datetime).toISOString(),
        status: 'scheduled',
      }),
    });
    setBusy(false);
    setEdit(null);
    r.refresh();
  }

  const selectedDayPosts = selectedDay ? (postsByDate.get(`${selectedDay}`) ?? []) : [];
  const selectedDayPlanned = selectedDay ? (plannedByDate.get(`${selectedDay}`) ?? []) : [];
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  const defaultDatetimeFor = (day: number) =>
    toLocalInput(new Date(year, month, day, 9, 0));

  const legend: EsKey[] = ['published', 'scheduled', 'review', 'drafting', 'planned'];
  const dayPanelLabel = selectedDay ? `${MONTHS[month].slice(0, 3)} ${selectedDay}` : `${MONTHS[month]} ${year}`;
  const hasDayContent = selectedDayPosts.length > 0 || selectedDayPlanned.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>Calendar</h1>
        <Link href="/dashboard" className="gv-back" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--gv-dim)', textDecoration: 'none' }}>← Pipeline</Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* calendar */}
        <div className="gv-card" style={{ border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', background: 'var(--gv-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <button onClick={prevMonth} className="gv-ghost" style={navBtn}>‹</button>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} className="gv-ghost" style={navBtn}>›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, marginBottom: 6 }}>
            {DAYS.map(d => (
              <div key={d} style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', textAlign: 'center', paddingBottom: 4 }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
            {cells.map((c, i) => {
              const dayPosts = !c.out ? (postsByDate.get(`${c.day}`) ?? []) : [];
              const dayPlanned = !c.out ? (plannedByDate.get(`${c.day}`) ?? []) : [];
              const active = !c.out && c.day === selectedDay;
              const todayCell = !c.out && isToday(c.day);
              const shown = [
                ...dayPosts.map(p => ({ kind: 'post' as const, key: statusKey(p.status), label: p.title ?? p.topic ?? '(draft)', id: p.id })),
                ...dayPlanned.map(s => ({ kind: 'planned' as const, key: 'planned' as const, label: s.topic, id: s.slot_id })),
              ];
              return (
                <div
                  key={i}
                  className="gv-day"
                  onClick={() => !c.out && (setSelectedDay(active ? null : c.day), setEdit(null))}
                  style={{
                    minHeight: 70, minWidth: 0, overflow: 'hidden', borderRadius: 10,
                    background: c.out ? 'transparent' : active ? 'rgba(162,255,1,0.09)' : todayCell ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${c.out ? 'transparent' : active ? 'rgba(162,255,1,0.3)' : todayCell ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    padding: '8px 8px 6px', display: 'flex', flexDirection: 'column', gap: 4,
                    cursor: c.out ? 'default' : 'pointer', transition: 'border-color .15s',
                  }}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 700, alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums',
                    color: c.out ? '#2c2e28' : todayCell ? 'var(--gv-ink)' : 'var(--gv-dim)',
                  }}>{c.day}</span>
                  {!c.out && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      {shown.slice(0, 2).map(it => {
                        const es = ES[it.key];
                        return (
                          <span key={it.id} title={`${es.name} · ${it.label}`} style={{
                            display: 'block', fontSize: 10, fontWeight: 600, lineHeight: 1.3,
                            color: es.color, background: es.bg, borderStyle: es.line, borderWidth: 1, borderColor: es.border,
                            borderRadius: 4, padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{it.label}</span>
                        );
                      })}
                      {shown.length > 2 && (
                        <span style={{ fontSize: 10, color: 'var(--gv-fainter)', padding: '0 5px' }}>+{shown.length - 2} more</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            {legend.map(k => {
              const es = ES[k];
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--gv-dim)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: es.line === 'solid' ? es.dot : 'transparent', borderStyle: es.line, borderColor: es.border, borderWidth: 1 }} />
                  {es.name}
                </div>
              );
            })}
          </div>
        </div>

        {/* day panel */}
        <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 14 }}>{dayPanelLabel}</div>

          {!selectedDay ? (
            <p style={{ fontSize: 12, color: 'var(--gv-faint)' }}>Pick a day on the calendar to see what&apos;s happening.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {selectedDayPosts.map(p => {
                  const es = ES[statusKey(p.status)];
                  const canReschedule = p.status === 'scheduled' || p.status === 'review';
                  const editing = edit?.postId === p.id;
                  return (
                    <div key={p.id} style={{ flex: '1 1 260px', minWidth: 220, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 12, padding: '12px 13px' }}>
                      <Link href={`/dashboard/posts/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{p.title ?? p.topic ?? '(draft)'}</div>
                      </Link>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: es.color }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: es.dot, flexShrink: 0 }} />
                        {(DRAFTING.has(p.status) ? 'DRAFTING' : es.name.toUpperCase())}
                        <span style={{ color: 'var(--gv-fainter)', fontWeight: 500 }}>
                          · {p.published_at ? fmtTime(p.published_at) : p.scheduled_at ? fmtTime(p.scheduled_at) : 'unscheduled'}
                        </span>
                      </div>
                      {canReschedule && !editing && (
                        <button onClick={() => setEdit({ postId: p.id, datetime: toLocalInput(new Date(p.scheduled_at ?? new Date(year, month, selectedDay, 9, 0))) })}
                          style={linkBtn}>Reschedule</button>
                      )}
                      {canReschedule && editing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          <input type="datetime-local" value={edit.datetime}
                            onChange={e => setEdit({ postId: p.id, datetime: e.target.value })}
                            style={inputStyle} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={saveSchedule} disabled={busy} className="btn btn-primary btn-sm">{busy ? 'Saving…' : 'Save'}</button>
                            <button onClick={() => setEdit(null)} style={linkBtn}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {selectedDayPlanned.map(s => (
                  <div key={s.slot_id} style={{ flex: '1 1 260px', minWidth: 220, border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 12, padding: '12px 13px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-soft)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{s.topic}</div>
                    <div style={{ fontSize: 11, color: 'var(--gv-fainter)', marginTop: 8 }}>planned · {s.intent} · {fmtTime(s.publish_date)} — auto-drafts ~3 days ahead</div>
                  </div>
                ))}

                {!hasDayContent && unscheduledReview.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--gv-faint)', padding: '10px 2px' }}>Nothing scheduled this day.</p>
                )}
              </div>

              {/* schedule an unscheduled review post onto this day */}
              {unscheduledReview.length > 0 && (
                <div style={{ marginTop: hasDayContent ? 16 : 0, paddingTop: hasDayContent ? 14 : 0, borderTop: hasDayContent ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <p style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 8 }}>Schedule a draft here:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {unscheduledReview.map(p => {
                      const editing = edit?.postId === p.id;
                      return (
                        <div key={p.id}>
                          <button
                            onClick={() => setEdit(editing ? null : { postId: p.id, datetime: defaultDatetimeFor(selectedDay) })}
                            style={{
                              textAlign: 'left', width: '100%', padding: '8px 12px', borderRadius: 8,
                              border: `1px solid ${editing ? 'rgba(162,255,1,0.4)' : 'var(--gv-line)'}`,
                              background: editing ? 'rgba(162,255,1,0.08)' : 'rgba(255,255,255,0.03)',
                              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--gv-soft)',
                              overflowWrap: 'anywhere',
                            }}>
                            {p.title ?? p.topic ?? '(draft)'}
                          </button>
                          {editing && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                              <input type="datetime-local" value={edit.datetime}
                                onChange={e => setEdit({ postId: p.id, datetime: e.target.value })}
                                style={inputStyle} />
                              <button onClick={saveSchedule} disabled={busy} className="btn btn-primary btn-sm">
                                {busy ? 'Scheduling…' : 'Schedule'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* independent of the selected day — every draft still waiting for a slot */}
        {unscheduledReview.length > 0 && (
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gv-amber)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Needs scheduling ({unscheduledReview.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {unscheduledReview.map(p => (
                <Link key={p.id} href={`/dashboard/posts/${p.id}`} style={{
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid var(--gv-line)', textDecoration: 'none', fontSize: 12, color: 'var(--gv-soft)',
                  overflowWrap: 'anywhere',
                }}>{p.title ?? p.topic ?? '(draft)'}</Link>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--gv-faint)', marginTop: 10 }}>Pick a day above, then choose a time to schedule.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.02)', color: 'var(--gv-dim)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, marginTop: 8, cursor: 'pointer',
  color: 'var(--gv-accent-ink)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline',
};
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--gv-line)', borderRadius: 8, padding: '6px 10px',
  fontSize: 12, fontFamily: 'inherit', color: 'var(--gv-ink)', background: 'rgba(255,255,255,0.03)', width: '100%',
};
