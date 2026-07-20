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

const STATUS_COLOR: Record<string, string> = {
  published: 'var(--moss)',
  scheduled: 'var(--gv-blue)',
  review: 'var(--gv-amber)',
  queued: 'var(--gv-sky)',
  researching: 'var(--gv-sky)',
  writing: 'var(--gv-sky)',
};
const DRAFTING = new Set(['queued', 'researching', 'writing']);

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
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // unified editor: scheduling a review post OR rescheduling an existing one
  const [edit, setEdit] = useState<{ postId: string; datetime: string } | null>(null);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ fontFamily: 'Inter', fontSize: 'clamp(22px, 5.5vw, 28px)', margin: 0 }}>Calendar</h4>
        <Link href="/dashboard" style={{ fontSize: 12, color: 'var(--moss)', textDecoration: 'none' }}>← Pipeline</Link>
      </div>

      <div className="r-split">
        {/* Calendar grid */}
        <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 16, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--line)' }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontFamily: 'Inter', fontSize: 20, fontWeight: 600 }}>{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} style={navBtn}>›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
            {DAYS.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--clay)', letterSpacing: '0.06em' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((day, i) => {
              const dayPosts = day ? (postsByDate.get(`${day}`) ?? []) : [];
              const dayPlanned = day ? (plannedByDate.get(`${day}`) ?? []) : [];
              const active = day === selectedDay;
              const todayCell = day ? isToday(day) : false;
              const isPast = day ? new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate()) : false;
              const shown = [...dayPosts.map(p => ({ kind: 'post' as const, p })), ...dayPlanned.map(s => ({ kind: 'planned' as const, s }))];
              return (
                <div
                  key={i}
                  className="cal-cell"
                  onClick={() => day && (setSelectedDay(active ? null : day), setEdit(null))}
                  style={{
                    borderRight: (i + 1) % 7 !== 0 ? '1px solid var(--line)' : 'none',
                    borderBottom: i < cells.length - 7 ? '1px solid var(--line)' : 'none',
                    background: active ? 'rgba(162,255,1,0.1)' : 'rgba(15,23,18,0.015)',
                    cursor: day ? 'pointer' : 'default', transition: 'background .12s',
                    minWidth: 0, overflow: 'hidden',   // keep long titles from blowing out the grid
                  }}
                >
                  {day && (
                    <>
                      <div style={{
                        fontSize: 13, fontWeight: todayCell ? 700 : 400,
                        color: todayCell ? 'var(--moss)' : isPast ? 'var(--clay)' : 'var(--ink)',
                        width: 24, height: 24, borderRadius: '50%',
                        background: todayCell ? 'rgba(89,148,94,0.12)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
                      }}>{day}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        {shown.slice(0, 2).map((it, idx) => it.kind === 'post' ? (
                          <div key={it.p.id} style={{
                            fontSize: 10, lineHeight: 1.3,
                            background: STATUS_COLOR[it.p.status] ?? 'var(--clay)',
                            color: 'white', borderRadius: 4, padding: '2px 5px',
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          }}>{it.p.title ?? it.p.topic ?? '(draft)'}</div>
                        ) : (
                          <div key={it.s.slot_id} style={{
                            fontSize: 10, lineHeight: 1.3, color: 'var(--clay)',
                            border: '1px dashed var(--clay)', borderRadius: 4, padding: '1px 5px',
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          }} title="Planned — drafts automatically before this date">{it.s.topic}</div>
                        ))}
                        {shown.length > 2 && (
                          <div style={{ fontSize: 10, color: 'var(--clay)' }}>+{shown.length - 2} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 16, padding: '12px 20px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
            {[['Published', 'var(--moss)'], ['Scheduled', 'var(--gv-blue)'], ['Review', 'var(--gv-amber)'], ['Drafting', 'var(--gv-sky)']].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--clay)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} /> {label}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--clay)' }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, border: '1px dashed var(--clay)' }} /> Planned
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selectedDay && (
            <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 15, marginBottom: 12 }}>
                {MONTHS[month]} {selectedDay}
              </div>

              {/* existing posts on this day */}
              {selectedDayPosts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {selectedDayPosts.map(p => {
                    const canReschedule = p.status === 'scheduled' || p.status === 'review';
                    const editing = edit?.postId === p.id;
                    return (
                      <div key={p.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)' }}>
                        <Link href={`/dashboard/posts/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3, overflowWrap: 'anywhere' }}>{p.title ?? p.topic ?? '(draft)'}</div>
                        </Link>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: canReschedule ? 8 : 0 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[p.status] ?? 'var(--clay)', display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: 'var(--clay)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {DRAFTING.has(p.status) ? 'drafting' : p.status}
                          </span>
                          {p.scheduled_at && !p.published_at && (
                            <span style={{ fontSize: 11, color: 'var(--clay)' }}>· {fmtTime(p.scheduled_at)}</span>
                          )}
                          {p.published_at && (
                            <span style={{ fontSize: 11, color: 'var(--clay)' }}>· {fmtTime(p.published_at)}</span>
                          )}
                        </div>
                        {canReschedule && !editing && (
                          <button onClick={() => setEdit({ postId: p.id, datetime: toLocalInput(new Date(p.scheduled_at ?? new Date(year, month, selectedDay, 9, 0))) })}
                            style={linkBtn}>Reschedule</button>
                        )}
                        {canReschedule && editing && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                </div>
              )}

              {/* planned slots on this day (read-only until materialized) */}
              {selectedDayPlanned.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {selectedDayPlanned.map(s => (
                    <div key={s.slot_id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px dashed var(--clay)' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 2, overflowWrap: 'anywhere' }}>{s.topic}</div>
                      <div style={{ fontSize: 10, color: 'var(--clay)' }}>planned · {s.intent} · {fmtTime(s.publish_date)} — auto-drafts ~3 days ahead</div>
                    </div>
                  ))}
                </div>
              )}

              {/* schedule an unscheduled review post onto this day */}
              {unscheduledReview.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--clay)', marginBottom: 8 }}>Schedule a draft here:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {unscheduledReview.map(p => {
                      const editing = edit?.postId === p.id;
                      return (
                        <div key={p.id}>
                          <button
                            onClick={() => setEdit(editing ? null : { postId: p.id, datetime: defaultDatetimeFor(selectedDay) })}
                            style={{
                              textAlign: 'left', width: '100%', padding: '8px 12px', borderRadius: 8,
                              border: `2px solid ${editing ? 'var(--moss)' : 'var(--line)'}`,
                              background: editing ? 'rgba(162,255,1,0.08)' : 'rgba(15,23,18,0.03)',
                              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--ink)',
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

              {selectedDayPosts.length === 0 && selectedDayPlanned.length === 0 && unscheduledReview.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--clay)' }}>Nothing scheduled. No drafts awaiting scheduling.</p>
              )}
            </div>
          )}

          {unscheduledReview.length > 0 && (
            <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gv-amber)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Needs scheduling ({unscheduledReview.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {unscheduledReview.map(p => (
                  <Link key={p.id} href={`/dashboard/posts/${p.id}`} style={{
                    display: 'block', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--line)', textDecoration: 'none', fontSize: 12, color: 'var(--ink)',
                    overflowWrap: 'anywhere',
                  }}>{p.title ?? p.topic ?? '(draft)'}</Link>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--clay)', marginTop: 10 }}>Pick a day, then choose a time to schedule.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 8,
  width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: 'var(--ink)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--moss)', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline',
};
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px',
  fontSize: 12, fontFamily: 'inherit', color: 'var(--ink)', width: '100%',
};
